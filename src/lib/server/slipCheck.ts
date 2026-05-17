import "server-only";

import { createHash } from "crypto";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import jsQR from "jsqr";
import sharp from "sharp";
import { recognize } from "tesseract.js";

export type SlipCheckResult = {
  imageHash: string;
  qrPayload?: string;
  qrAmount?: number;
  ocrText?: string;
  ocrAmount?: number;
  detectedAmount?: number;
  amountSource: "qr" | "ocr" | null;
  slipTransactionId?: string;
  qrReadable: boolean;
  amountMatches: boolean | null;
  receiverAccountMatches: boolean | null;
  receiverNameMatches: boolean | null;
  detectedReceiverName?: string;
  rawDetectedReceiverName?: string;
};

export type SlipCheckOptions = {
  expectedReceiverAccounts?: string[];
  expectedReceiverName?: string;
  paymentMethod?: string;
  transactionAccountExclusions?: string[];
};

export async function analyzeSlipImage(
  data: Buffer,
  expectedAmount: number,
  options: SlipCheckOptions = {}
): Promise<SlipCheckResult> {
  const imageHash = createHash("sha256").update(data).digest("hex");
  const [qrPayload, ocrText] = await Promise.all([
    readQrPayload(data),
    readOcrText(data),
  ]);
  const qrAmount = qrPayload ? extractEmvAmount(qrPayload) : undefined;
  const ocrAmount = extractAmountFromText(ocrText, expectedAmount);
  const detectedAmount = typeof qrAmount === "number" ? qrAmount : ocrAmount;
  const amountSource = typeof qrAmount === "number" ? "qr" : typeof ocrAmount === "number" ? "ocr" : null;
  const expectedAccounts = normalizeExpectedAccounts(options.expectedReceiverAccounts);
  const transactionAccountExclusions = normalizeExpectedAccounts([
    ...(options.expectedReceiverAccounts || []),
    ...(options.transactionAccountExclusions || []),
  ]);
  const expectedReceiverName = options.expectedReceiverName?.trim();
  const searchableText = [qrPayload, ocrText].filter(Boolean).join("\n");
  const rawDetectedReceiverName = extractReceiverNameFromText(ocrText, options.paymentMethod);
  const amountMatches =
    typeof detectedAmount === "number" && Number.isFinite(expectedAmount) && expectedAmount > 0
      ? Math.abs(detectedAmount - expectedAmount) < 0.01
      : null;
  const receiverAccountMatches = searchableText && expectedAccounts.length > 0
    ? containsExpectedAccount(searchableText, expectedAccounts)
    : null;
  const receiverNameMatches = searchableText && expectedReceiverName
    ? containsExpectedName([searchableText, rawDetectedReceiverName].filter(Boolean).join("\n"), expectedReceiverName)
    : null;
  const detectedReceiverName = receiverNameMatches === true && expectedReceiverName
    ? expectedReceiverName
    : rawDetectedReceiverName;
  const slipTransactionId = qrPayload
    ? extractSlipTransactionId(qrPayload, transactionAccountExclusions, qrAmount)
    : undefined;

  return {
    imageHash,
    qrPayload,
    qrAmount,
    ocrText,
    ocrAmount,
    detectedAmount,
    amountSource,
    slipTransactionId,
    qrReadable: Boolean(qrPayload),
    amountMatches,
    receiverAccountMatches,
    receiverNameMatches,
    detectedReceiverName,
    rawDetectedReceiverName,
  };
}

async function readQrPayload(data: Buffer) {
  try {
    const image = await sharp(data)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = new Uint8ClampedArray(
      image.data.buffer,
      image.data.byteOffset,
      image.data.byteLength
    );
    return jsQR(pixels, image.info.width, image.info.height)?.data;
  } catch (error) {
    console.error("Failed to read slip QR payload", error);
    return undefined;
  }
}

async function readOcrText(data: Buffer) {
  try {
    const lang = process.env.SLIP_OCR_LANG || "eng+tha";
    const langPath = ensureLocalTessdata(lang);
    const metadata = await sharp(data).rotate().metadata();
    const prepared = await sharp(data)
      .rotate()
      .resize({ width: 1800, withoutEnlargement: true })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
    const topCrop = metadata.width && metadata.height
      ? await sharp(data)
        .rotate()
        .extract({
          left: 0,
          top: 0,
          width: metadata.width,
          height: Math.max(1, Math.round(metadata.height * 0.28)),
        })
        .resize({ width: 2400 })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer()
      : undefined;
    const middleCrop = metadata.width && metadata.height
      ? await sharp(data)
        .rotate()
        .extract({
          left: 0,
          top: Math.max(0, Math.round(metadata.height * 0.12)),
          width: metadata.width,
          height: Math.max(1, Math.round(metadata.height * 0.5)),
        })
        .resize({ width: 2400 })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer()
      : undefined;
    const buffers = [prepared, topCrop, middleCrop].filter((buffer): buffer is Buffer => Boolean(buffer));
    const results = await Promise.all(
      buffers.map((buffer) => recognize(buffer, lang, createOcrOptions(langPath)))
    );

    return results
      .map((result) => result.data.text.trim())
      .filter(Boolean)
      .join("\n") || undefined;
  } catch (error) {
    console.error("Failed to read slip OCR text", error);
    return undefined;
  }
}

function createOcrOptions(langPath: string) {
  return {
    langPath,
    cachePath: langPath,
    cacheMethod: "none" as const,
    logger: () => {},
  };
}

function ensureLocalTessdata(langText: string) {
  const targetDir = path.join("/tmp", "check-slip-tessdata");
  fs.mkdirSync(targetDir, { recursive: true });

  for (const lang of langText.split("+").map((item) => item.trim()).filter(Boolean)) {
    const target = path.join(targetDir, `${lang}.traineddata.gz`);
    if (fs.existsSync(target)) continue;

    const source = resolveTessdataPath(lang);
    fs.copyFileSync(source, target);
  }

  return targetDir;
}

function resolveTessdataPath(lang: string) {
  const require = createRequire(import.meta.url);
  let langPackage: { langPath: string };

  if (lang === "eng") {
    langPackage = require("@tesseract.js-data/eng") as { langPath: string };
  } else if (lang === "tha") {
    langPackage = require("@tesseract.js-data/tha") as { langPath: string };
  } else {
    throw new Error(`Unsupported OCR language "${lang}". Supported values are "eng" and "tha".`);
  }

  return path.join(langPackage.langPath, `${lang}.traineddata.gz`);
}

function extractEmvAmount(payload: string) {
  const parsed = parseTlv(payload);
  for (const node of flattenTlv(parsed.nodes)) {
    if (node.tag === "54") {
      const amount = Number(node.value);
      return Number.isFinite(amount) ? amount : undefined;
    }
  }
  return undefined;
}

function extractAmountFromText(text: string | undefined, expectedAmount: number) {
  if (!text) return undefined;

  const normalizedText = text.replace(/[|]/g, " ");
  const candidates: Array<{ value: number; score: number }> = [];
  const amountRegex = /(?:จำนวนเงิน|ยอดเงิน|ยอด|amount|total|บาท|฿)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(?:บาท|฿|baht|thb)?/giu;

  for (const match of normalizedText.matchAll(amountRegex)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0 || value > 100000) continue;

    const contextStart = Math.max(0, (match.index || 0) - 18);
    const contextEnd = Math.min(normalizedText.length, (match.index || 0) + match[0].length + 18);
    const context = normalizedText.slice(contextStart, contextEnd);
    const amountWordScore = /จำนวนเงิน|ยอดเงิน|ยอด|amount|total|บาท|฿|baht|thb/i.test(context) ? 20 : 0;
    const expectedScore = Number.isFinite(expectedAmount) && expectedAmount > 0 && Math.abs(value - expectedAmount) < 0.01 ? 15 : 0;
    const decimalScore = /\.[0-9]{2}/.test(match[1]) ? 4 : 0;
    candidates.push({ value, score: amountWordScore + expectedScore + decimalScore });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value;
}

type TlvNode = {
  tag: string;
  path: string;
  value: string;
  children: TlvNode[];
};

type ExpectedReceiverAccount = {
  raw: string;
  digits: string;
  hasMask: boolean;
};

function parseTlv(input: string, prefix = ""): { nodes: TlvNode[]; complete: boolean } {
  const nodes: TlvNode[] = [];
  let index = 0;

  while (index + 4 <= input.length) {
    const tag = input.slice(index, index + 2);
    const lengthText = input.slice(index + 2, index + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) return { nodes, complete: false };

    const length = Number(lengthText);
    const valueStart = index + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > input.length) return { nodes, complete: false };

    const value = input.slice(valueStart, valueEnd);
    const path = prefix ? `${prefix}.${tag}` : tag;
    const childResult = parseTlv(value, path);
    const children = childResult.complete && childResult.nodes.length > 0 ? childResult.nodes : [];
    nodes.push({ tag, path, value, children });
    index = valueEnd;
  }

  return { nodes, complete: index === input.length };
}

function flattenTlv(nodes: TlvNode[]): TlvNode[] {
  return nodes.flatMap((node) => [node, ...flattenTlv(node.children)]);
}

function normalizeExpectedAccounts(accounts: string[] | undefined) {
  return (accounts || [])
    .map((account) => ({
      raw: account.trim(),
      digits: normalizeDigits(account),
      hasMask: /[x*]/i.test(account),
    }))
    .filter((account) => account.raw.length > 0 && (account.digits.length >= 4 || account.hasMask));
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

function removeLeadingZeros(value: string) {
  return value.replace(/^0+/, "");
}

function containsExpectedAccount(payload: string, expectedAccounts: ExpectedReceiverAccount[]) {
  const payloadDigits = normalizeDigits(payload);
  const normalizedPayload = normalizeTextForSearch(payload);
  const payloadHasMask = /[x*]/i.test(normalizedPayload);
  return expectedAccounts.some((account) => {
    const withoutLeadingZeros = removeLeadingZeros(account.digits);
    const normalizedRaw = normalizeTextForSearch(account.raw);
    const visibleFragments = fourDigitFragments(account.digits);
    return (
      (account.digits.length >= 4 && payloadDigits.includes(account.digits)) ||
      (withoutLeadingZeros.length >= 4 && payloadDigits.includes(withoutLeadingZeros)) ||
      (payloadHasMask && visibleFragments.some((fragment) => normalizedPayload.includes(fragment))) ||
      (account.hasMask && normalizedRaw.length >= 4 && normalizedPayload.includes(normalizedRaw))
    );
  });
}

function fourDigitFragments(value: string) {
  const fragments: string[] = [];
  for (let index = 0; index + 4 <= value.length; index += 1) {
    fragments.push(value.slice(index, index + 4));
  }
  return fragments;
}

function containsExpectedName(payload: string, expectedName: string) {
  const normalizedPayload = normalizeTextForSearch(payload);
  return nameVariants(expectedName).some((name) => {
    if (name.length < 2) return false;
    if (normalizedPayload.includes(name)) return true;

    return nameTokens(name).some((token) => fuzzyIncludes(normalizedPayload, token));
  });
}

function extractReceiverNameFromText(text: string | undefined, paymentMethod: string | undefined) {
  if (!text) return undefined;

  if (paymentMethod === "truemoney") {
    const trueMoneyName = extractTrueMoneyReceiverName(text);
    if (trueMoneyName) return trueMoneyName;
  }

  return extractLikelyThaiName(text);
}

function extractTrueMoneyReceiverName(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter(Boolean);
  const walletAccountIndexes = lines
    .map((line, index) => isTrueMoneyWalletAccountLine(line) ? index : -1)
    .filter((index) => index >= 0);

  for (const accountIndex of walletAccountIndexes.slice().reverse()) {
    const candidate = findNameBeforeLine(lines, accountIndex);
    if (candidate) return candidate;
  }

  return extractLikelyThaiName(text);
}

function findNameBeforeLine(lines: string[], index: number) {
  for (let cursor = index - 1; cursor >= 0 && cursor >= index - 4; cursor -= 1) {
    const line = lines[cursor];
    if (isLikelySlipLabel(line)) continue;

    const name = extractThaiNameFromLine(line);
    if (name) return name;
  }

  return undefined;
}

function extractLikelyThaiName(text: string) {
  return text
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .map(extractThaiNameFromLine)
    .find((name): name is string => Boolean(name));
}

function extractThaiNameFromLine(line: string | undefined) {
  if (!line || isLikelySlipLabel(line)) return undefined;

  const cleaned = line
    .replace(/[A-Za-z0-9๐-๙*#@_:.,/\\|()[\]{}\-"'“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[ก-๙]/.test(cleaned)) return undefined;

  const compacted = compactSpacedThaiText(cleaned);
  if (compacted.length < 4 || compacted.length > 64) return undefined;
  if (isLikelySlipLabel(compacted)) return undefined;

  return compacted;
}

function cleanOcrLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function isLikelySlipLabel(line: string) {
  const normalized = normalizeTextForSearch(line);
  return /จำนวน|ยอด|บาท|วันที่|เวลา|หมายเลข|รายการ|สถานที่|สแกน|ตรวจสอบ|บัญชี|wallet|account|truemoney|truemon|จาก|ไปยัง/i.test(normalized);
}

function isTrueMoneyWalletAccountLine(line: string) {
  const normalized = normalizeTextForSearch(line);
  return /บัญชีทรูมันนี่|บัญชีทรมันนี่|ทรูมันนี่|ทรมันนี่|truemoney|truemon/i.test(normalized) && /[0-9*Xx]{2,}/.test(line);
}

function compactSpacedThaiText(value: string) {
  return value
    .replace(/\s+(?=[ก-๙])/g, "")
    .replace(/(?<=[ก-๙])\s+/g, "")
    .trim();
}

function nameVariants(name: string) {
  const normalizedName = normalizeTextForSearch(name);
  return Array.from(new Set([
    normalizedName,
    normalizedName.replace(/^(ดช|เด็กชาย|นาย)/, ""),
    normalizedName.replace(/^(ดญ|เด็กหญิง|นางสาว|นส)/, ""),
  ].filter(Boolean)));
}

function normalizeTextForSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("th-TH")
    .replace(/[\s._\-:|/\\()[\]{}]+/g, "");
}

function nameTokens(normalizedName: string) {
  return normalizedName
    .split(/(?=ปัญ|กุล|วงศ์|ทรัพย์|ศักดิ์|รัตน์|พร|ชัย|ธาร)/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function fuzzyIncludes(payload: string, token: string) {
  if (payload.includes(token)) return true;

  const maxDistance = token.length <= 6 ? 2 : Math.max(2, Math.floor(token.length * 0.18));
  for (let index = 0; index + token.length <= payload.length; index += 1) {
    const candidate = payload.slice(index, index + token.length);
    if (levenshteinDistance(candidate, token, maxDistance) <= maxDistance) return true;
  }

  return false;
}

function levenshteinDistance(a: string, b: string, maxDistance: number) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) return rowMin;
    previous = current;
  }

  return previous[b.length];
}

function extractSlipTransactionId(payload: string, expectedAccounts: ExpectedReceiverAccount[], amount: number | undefined) {
  const parsed = parseTlv(payload);
  const nodes = flattenTlv(parsed.nodes);
  const preferredValues = nodes
    .filter((node) => node.path.startsWith("62.") && ["05", "07", "08", "09"].includes(node.tag))
    .map((node) => node.value);
  const tlvValues = nodes.map((node) => node.value);
  const rawValues = payload.match(/[A-Za-z0-9]{10,}/g) || [];

  return [...preferredValues, ...tlvValues, ...rawValues]
    .map(cleanTransactionCandidate)
    .find((candidate) => isLikelyTransactionId(candidate, expectedAccounts, amount));
}

function cleanTransactionCandidate(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function isLikelyTransactionId(candidate: string, expectedAccounts: ExpectedReceiverAccount[], amount: number | undefined) {
  if (candidate.length < 10 || candidate.length > 80) return false;
  if (/^A0{3,}/.test(candidate)) return false;
  if (/^0+$/.test(candidate)) return false;

  const candidateDigits = normalizeDigits(candidate);
  if (candidateDigits.length >= 6) {
    if (expectedAccounts.some((account) =>
      (account.digits.length >= 4 && candidateDigits.includes(account.digits)) ||
      (removeLeadingZeros(account.digits).length >= 4 && candidateDigits.includes(removeLeadingZeros(account.digits)))
    )) {
      return false;
    }
    if (typeof amount === "number") {
      const amountDigits = normalizeDigits(amount.toFixed(2));
      if (candidateDigits === amountDigits) return false;
    }
  }

  return true;
}

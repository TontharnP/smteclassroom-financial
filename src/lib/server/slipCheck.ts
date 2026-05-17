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
};

export type SlipCheckOptions = {
  expectedReceiverAccounts?: string[];
  expectedReceiverName?: string;
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
  const expectedReceiverName = options.expectedReceiverName?.trim();
  const searchableText = [qrPayload, ocrText].filter(Boolean).join("\n");
  const amountMatches =
    typeof detectedAmount === "number" && Number.isFinite(expectedAmount) && expectedAmount > 0
      ? Math.abs(detectedAmount - expectedAmount) < 0.01
      : null;
  const receiverAccountMatches = searchableText && expectedAccounts.length > 0
    ? containsExpectedAccount(searchableText, expectedAccounts)
    : null;
  const receiverNameMatches = searchableText && expectedReceiverName
    ? containsExpectedName(searchableText, expectedReceiverName)
    : null;
  const slipTransactionId = qrPayload
    ? extractSlipTransactionId(qrPayload, expectedAccounts, qrAmount)
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
    const buffers = [prepared, topCrop].filter((buffer): buffer is Buffer => Boolean(buffer));
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
  return nameVariants(expectedName).some((name) => name.length >= 2 && normalizedPayload.includes(name));
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

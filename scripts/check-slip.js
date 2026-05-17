#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const sharp = require("sharp");
const jsQrModule = require("jsqr");
const { recognize } = require("tesseract.js");

const jsQR = jsQrModule.default || jsQrModule;
const PROMPTPAY_ID = "004666006046829";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const imagePath = args._[0];
  if (!imagePath) {
    console.error("Usage: node scripts/check-slip.js <image_path> --amount <expected_amount> [--method bank|truemoney] [--account <receiver_account>] [--name <receiver_name>]");
    console.error("Example bank: node scripts/check-slip.js ./slip.jpg --amount 80 --method bank");
    console.error("Example TrueMoney: node scripts/check-slip.js ./slip.jpg --amount 10 --method truemoney");
    process.exit(1);
  }

  const env = readDotEnv(path.join(process.cwd(), ".env.local"));
  if (env.SLIP_OCR_LANG) process.env.SLIP_OCR_LANG = env.SLIP_OCR_LANG;
  if (env.TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH) {
    process.env.TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH = env.TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH;
  }
  const resolvedPath = path.resolve(process.cwd(), imagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const paymentMethod = args.method || args.m || "bank";
  const expectedAmount = Number(args.amount || args.a || args._[1] || 0);
  const expectedReceiverAccounts = getExpectedSlipReceiverAccounts(paymentMethod, env, args.account);
  const expectedReceiverName = args.name || getExpectedSlipReceiverName(paymentMethod, env) || "";

  const data = fs.readFileSync(resolvedPath);
  const result = await analyzeSlipImage(data, expectedAmount, {
    expectedReceiverAccounts,
    expectedReceiverName,
    paymentMethod,
  });

  const report = {
    file: resolvedPath,
    expected: {
      method: paymentMethod,
      amount: expectedAmount || null,
      receiverAccounts: expectedReceiverAccounts,
      receiverName: expectedReceiverName || null,
    },
    extracted: result,
    decision: {
      wouldAutoReject: wouldAutoReject(result, paymentMethod),
      wouldAutoApprove:
        result.qrReadable &&
        result.amountMatches === true &&
        result.receiverAccountMatches === true &&
        (!expectedReceiverName || result.receiverNameMatches === true) &&
        Boolean(result.slipTransactionId),
      looksGood:
        result.qrReadable &&
        result.amountMatches === true &&
        result.receiverAccountMatches === true &&
        (!expectedReceiverName || result.receiverNameMatches === true) &&
        Boolean(result.slipTransactionId),
      reasons: buildReasons(result),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

async function analyzeSlipImage(data, expectedAmount, options = {}) {
  const imageHash = createHash("sha256").update(data).digest("hex");
  const [qrPayload, ocrText] = await Promise.all([
    readQrPayload(data),
    readOcrText(data),
  ]);
  const qrAmount = qrPayload ? extractEmvAmount(qrPayload) : undefined;
  const ocrAmount = extractAmountFromText(ocrText, expectedAmount);
  const detectedAmount = typeof qrAmount === "number" ? qrAmount : ocrAmount;
  const expectedAccounts = normalizeExpectedAccounts(options.expectedReceiverAccounts);
  const expectedReceiverName = options.expectedReceiverName && options.expectedReceiverName.trim();
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
    ? extractSlipTransactionId(qrPayload, expectedAccounts, qrAmount)
    : undefined;

  return {
    imageHash,
    qrReadable: Boolean(qrPayload),
    qrPayload,
    qrAmount,
    ocrText,
    ocrAmount,
    detectedAmount,
    amountSource: typeof qrAmount === "number" ? "qr" : typeof ocrAmount === "number" ? "ocr" : null,
    amountMatches,
    receiverAccountMatches,
    receiverNameMatches,
    detectedReceiverName,
    rawDetectedReceiverName,
    slipTransactionId,
  };
}

async function readQrPayload(data) {
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
}

async function readOcrText(data) {
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
    const buffers = [prepared, topCrop, middleCrop].filter(Boolean);
    const results = await Promise.all(
      buffers.map((buffer) => recognize(buffer, lang, createOcrOptions(langPath)))
    );
    return results
      .map((result) => result.data.text.trim())
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    return `__OCR_ERROR__: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function createOcrOptions(langPath) {
  return {
    langPath,
    cachePath: langPath,
    cacheMethod: "none",
    logger: () => {},
  };
}

function ensureLocalTessdata(langText) {
  const targetDir = path.join(process.cwd(), "node_modules", ".cache", "check-slip-tessdata");
  fs.mkdirSync(targetDir, { recursive: true });

  for (const lang of langText.split("+").map((item) => item.trim()).filter(Boolean)) {
    const target = path.join(targetDir, `${lang}.traineddata.gz`);
    if (fs.existsSync(target)) continue;

    const source = resolveTessdataPath(lang);
    fs.copyFileSync(source, target);
  }

  return targetDir;
}

function resolveTessdataPath(lang) {
  try {
    const langPackage = require(`@tesseract.js-data/${lang}`);
    return path.join(langPackage.langPath, `${lang}.traineddata.gz`);
  } catch {
    throw new Error(
      `Missing OCR language data for "${lang}". Install it with: npm install @tesseract.js-data/${lang}`
    );
  }
}

function extractEmvAmount(payload) {
  const parsed = parseTlv(payload);
  for (const node of flattenTlv(parsed.nodes)) {
    if (node.tag === "54") {
      const amount = Number(node.value);
      return Number.isFinite(amount) ? amount : undefined;
    }
  }
  return undefined;
}

function extractAmountFromText(text, expectedAmount) {
  if (!text || text.startsWith("__OCR_ERROR__")) return undefined;
  const normalizedText = text.replace(/[|]/g, " ");
  const candidates = [];
  const amountRegex = /(?:จำนวนเงิน|ยอดเงิน|ยอด|amount|total|บาท|฿)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(?:บาท|฿|baht|thb)?/giu;

  for (const match of normalizedText.matchAll(amountRegex)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value > 100000) continue;
    const contextStart = Math.max(0, match.index - 18);
    const contextEnd = Math.min(normalizedText.length, match.index + match[0].length + 18);
    const context = normalizedText.slice(contextStart, contextEnd);
    const amountWordScore = /จำนวนเงิน|ยอดเงิน|ยอด|amount|total|บาท|฿|baht|thb/i.test(context) ? 20 : 0;
    const expectedScore = Number.isFinite(expectedAmount) && expectedAmount > 0 && Math.abs(value - expectedAmount) < 0.01 ? 15 : 0;
    const decimalScore = /\.[0-9]{2}/.test(match[1]) ? 4 : 0;
    candidates.push({ value, score: amountWordScore + expectedScore + decimalScore, context });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value;
}

function parseTlv(input, prefix = "") {
  const nodes = [];
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
    const pathText = prefix ? `${prefix}.${tag}` : tag;
    const childResult = parseTlv(value, pathText);
    const children = childResult.complete && childResult.nodes.length > 0 ? childResult.nodes : [];
    nodes.push({ tag, path: pathText, value, children });
    index = valueEnd;
  }

  return { nodes, complete: index === input.length };
}

function flattenTlv(nodes) {
  return nodes.flatMap((node) => [node, ...flattenTlv(node.children)]);
}

function normalizeExpectedAccounts(accounts) {
  return (accounts || [])
    .map((account) => ({
      raw: String(account).trim(),
      digits: normalizeDigits(String(account)),
      hasMask: /[x*]/i.test(String(account)),
    }))
    .filter((account) => account.raw.length > 0 && (account.digits.length >= 4 || account.hasMask));
}

function normalizeDigits(value) {
  return String(value).replace(/\D/g, "");
}

function removeLeadingZeros(value) {
  return String(value).replace(/^0+/, "");
}

function containsExpectedAccount(payload, expectedAccounts) {
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

function fourDigitFragments(value) {
  const fragments = [];
  for (let index = 0; index + 4 <= value.length; index += 1) {
    fragments.push(value.slice(index, index + 4));
  }
  return fragments;
}

function containsExpectedName(payload, expectedName) {
  const normalizedPayload = normalizeTextForSearch(payload);
  return nameVariants(expectedName).some((name) => {
    if (name.length < 2) return false;
    if (normalizedPayload.includes(name)) return true;

    return nameTokens(name).some((token) => fuzzyIncludes(normalizedPayload, token));
  });
}

function extractReceiverNameFromText(text, paymentMethod) {
  if (!text || String(text).startsWith("__OCR_ERROR__")) return undefined;

  if (paymentMethod === "truemoney") {
    const trueMoneyName = extractTrueMoneyReceiverName(text);
    if (trueMoneyName) return trueMoneyName;
  }

  return extractLikelyThaiName(text);
}

function extractTrueMoneyReceiverName(text) {
  const lines = String(text)
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

function findNameBeforeLine(lines, index) {
  for (let cursor = index - 1; cursor >= 0 && cursor >= index - 4; cursor -= 1) {
    const line = lines[cursor];
    if (isLikelySlipLabel(line)) continue;

    const name = extractThaiNameFromLine(line);
    if (name) return name;
  }

  return undefined;
}

function extractLikelyThaiName(text) {
  return String(text)
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .map(extractThaiNameFromLine)
    .find(Boolean);
}

function extractThaiNameFromLine(line) {
  if (!line || isLikelySlipLabel(line)) return undefined;

  const cleaned = String(line)
    .replace(/[A-Za-z0-9๐-๙*#@_:.,/\\|()[\]{}\-"'“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[ก-๙]/.test(cleaned)) return undefined;

  const compacted = compactSpacedThaiText(cleaned);
  if (compacted.length < 4 || compacted.length > 64) return undefined;
  if (isLikelySlipLabel(compacted)) return undefined;

  return compacted;
}

function cleanOcrLine(line) {
  return String(line).replace(/\s+/g, " ").trim();
}

function isLikelySlipLabel(line) {
  const normalized = normalizeTextForSearch(line);
  return /จำนวน|ยอด|บาท|วันที่|เวลา|หมายเลข|รายการ|สถานที่|สแกน|ตรวจสอบ|บัญชี|wallet|account|truemoney|truemon|จาก|ไปยัง/i.test(normalized);
}

function isTrueMoneyWalletAccountLine(line) {
  const normalized = normalizeTextForSearch(line);
  return /บัญชีทรูมันนี่|บัญชีทรมันนี่|ทรูมันนี่|ทรมันนี่|truemoney|truemon/i.test(normalized) && /[0-9*Xx]{2,}/.test(String(line));
}

function compactSpacedThaiText(value) {
  return String(value)
    .replace(/\s+(?=[ก-๙])/g, "")
    .replace(/(?<=[ก-๙])\s+/g, "")
    .trim();
}

function nameVariants(name) {
  const normalizedName = normalizeTextForSearch(name);
  return Array.from(new Set([
    normalizedName,
    normalizedName.replace(/^(ดช|เด็กชาย|นาย)/, ""),
    normalizedName.replace(/^(ดญ|เด็กหญิง|นางสาว|นส)/, ""),
  ].filter(Boolean)));
}

function normalizeTextForSearch(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("th-TH")
    .replace(/[\s._\-:|/\\()[\]{}]+/g, "");
}

function nameTokens(normalizedName) {
  return String(normalizedName)
    .split(/(?=ปัญ|กุล|วงศ์|ทรัพย์|ศักดิ์|รัตน์|พร|ชัย|ธาร)/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function fuzzyIncludes(payload, token) {
  if (payload.includes(token)) return true;

  const maxDistance = token.length <= 6 ? 2 : Math.max(2, Math.floor(token.length * 0.18));
  for (let index = 0; index + token.length <= payload.length; index += 1) {
    const candidate = payload.slice(index, index + token.length);
    if (levenshteinDistance(candidate, token, maxDistance) <= maxDistance) return true;
  }

  return false;
}

function levenshteinDistance(a, b, maxDistance) {
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

function extractSlipTransactionId(payload, expectedAccounts, amount) {
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

function cleanTransactionCandidate(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function isLikelyTransactionId(candidate, expectedAccounts, amount) {
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

function buildReasons(result) {
  const reasons = [];
  if (!result.qrReadable) reasons.push("QR could not be read from image");
  if (result.amountMatches === false) reasons.push("Amount does not match expected amount");
  if (result.amountMatches === null) reasons.push("Amount was not checked or not found");
  if (result.receiverAccountMatches === false) reasons.push("Receiver account did not match");
  if (result.receiverAccountMatches === null) reasons.push("Receiver account was not checked or not found");
  if (result.receiverNameMatches === false) reasons.push("Receiver name did not match");
  if (result.receiverNameMatches === null) reasons.push("Receiver name was not checked or not found");
  if (!result.slipTransactionId) reasons.push("Transaction/reference id was not found");
  return reasons.length > 0 ? reasons : ["All local checks passed"];
}

function wouldAutoReject(result, paymentMethod) {
  const canAutoRejectReceiverMismatch =
    paymentMethod !== "truemoney" ||
    process.env.TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH === "true";

  return (
    result.amountMatches === false ||
    (canAutoRejectReceiverMismatch && result.receiverAccountMatches === false) ||
    (canAutoRejectReceiverMismatch && result.receiverNameMatches === false) ||
    (
      !result.qrReadable &&
      !result.slipTransactionId &&
      result.amountMatches !== true &&
      result.receiverAccountMatches !== true &&
      result.receiverNameMatches !== true
    )
  );
}

function getExpectedSlipReceiverAccounts(method, env, overrideAccount) {
  const configured = method === "truemoney"
    ? [
      overrideAccount,
      env.TRUEMONEY_RECEIVER_ACCOUNT_NUMBER,
      env.TRUEMONEY_RECEIVER_ACCOUNT_NUMBERS,
    ]
    : [
      overrideAccount,
      PROMPTPAY_ID,
      env.SLIP_RECEIVER_ACCOUNT_NUMBER,
      env.SLIP_RECEIVER_ACCOUNT_NUMBERS,
    ];

  return Array.from(new Set(configured.flatMap(splitList).filter(Boolean)));
}

function getExpectedSlipReceiverName(method, env) {
  return (
    method === "truemoney"
      ? env.TRUEMONEY_RECEIVER_ACCOUNT_NAME || env.SLIP_RECEIVER_ACCOUNT_NAME
      : env.SLIP_RECEIVER_ACCOUNT_NAME
  );
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=");
    const key = rawKey.trim();
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined) index += 1;
    parsed[key] = value;
  }

  return parsed;
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

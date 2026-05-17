#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const sharp = require("sharp");
const jsQrModule = require("jsqr");
const { recognize } = require("tesseract.js");

const jsQR = jsQrModule.default || jsQrModule;

async function main() {
  const [imagePath, amountArg, accountArg, nameArg] = process.argv.slice(2);
  if (!imagePath) {
    console.error("Usage: node scripts/check-slip.js <image_path> [expected_amount] [receiver_account] [receiver_name]");
    console.error("Example: node scripts/check-slip.js ./slip.jpg 100 xxx-x-x4106-x \"ด.ช. ต้นธาร ปัญโญศักดิ์\"");
    process.exit(1);
  }

  const env = readDotEnv(path.join(process.cwd(), ".env.local"));
  if (env.SLIP_OCR_LANG) process.env.SLIP_OCR_LANG = env.SLIP_OCR_LANG;
  const resolvedPath = path.resolve(process.cwd(), imagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const expectedAmount = Number(amountArg || 0);
  const expectedReceiverAccounts = splitList(accountArg)
    .concat(splitList(env.SLIP_RECEIVER_ACCOUNT_NUMBER))
    .concat(splitList(env.SLIP_RECEIVER_ACCOUNT_NUMBERS))
    .concat(splitList(env.TRUEMONEY_RECEIVER_ACCOUNT_NUMBER))
    .filter(Boolean);
  const expectedReceiverName = nameArg || env.SLIP_RECEIVER_ACCOUNT_NAME || "";

  const data = fs.readFileSync(resolvedPath);
  const result = await analyzeSlipImage(data, expectedAmount, {
    expectedReceiverAccounts,
    expectedReceiverName,
  });

  const report = {
    file: resolvedPath,
    expected: {
      amount: expectedAmount || null,
      receiverAccounts: expectedReceiverAccounts,
      receiverName: expectedReceiverName || null,
    },
    extracted: result,
    decision: {
      looksGood:
        result.qrReadable &&
        result.amountMatches === true &&
        result.receiverAccountMatches === true &&
        result.receiverNameMatches === true &&
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
    const topCrop = await sharp(data)
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
      .toBuffer();
    const [fullResult, topResult] = await Promise.all([
      recognize(prepared, lang, createOcrOptions(langPath)),
      recognize(topCrop, lang, createOcrOptions(langPath)),
    ]);
    return [fullResult.data.text.trim(), topResult.data.text.trim()]
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
  return nameVariants(expectedName).some((name) => name.length >= 2 && normalizedPayload.includes(name));
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

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

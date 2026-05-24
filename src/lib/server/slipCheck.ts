import "server-only";

import { createHash } from "crypto";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import jsQR from "jsqr";
import sharp from "sharp";
import { recognize } from "tesseract.js";
import { verifySlipWithEasySlip, type EasySlipVerifyData } from "@/lib/server/easySlip";
import { getRuntimeSettings } from "@/lib/server/appSettings";

const DEFAULT_OCR_MAX_VARIANTS = 10;
const OCR_BATCH_SIZE = 2;

export type SlipCheckResult = {
  imageHash: string;
  qrPayload?: string;
  qrAmount?: number;
  ocrText?: string;
  ocrAmount?: number;
  detectedAmount?: number;
  amountSource: "easyslip" | "qr" | "ocr" | null;
  slipTransactionId?: string;
  qrReadable: boolean;
  amountMatches: boolean | null;
  receiverAccountMatches: boolean | null;
  receiverNameMatches: boolean | null;
  detectedReceiverName?: string;
  rawDetectedReceiverName?: string;
  provider: "easyslip" | "local";
  easySlipMethod?: "payload" | "image";
  easySlipVerified: boolean;
  easySlipDuplicate: boolean;
  easySlipError?: string;
};

export type SlipCheckOptions = {
  expectedReceiverAccounts?: string[];
  expectedReceiverName?: string;
  paymentMethod?: string;
  transactionAccountExclusions?: string[];
  contentType?: string;
  remark?: string;
};

export async function analyzeSlipImage(
  data: Buffer,
  expectedAmount: number,
  options: SlipCheckOptions = {}
): Promise<SlipCheckResult> {
  const settings = await getRuntimeSettings();
  const imageHash = createHash("sha256").update(data).digest("hex");
  const expectedAccounts = normalizeExpectedAccounts(options.expectedReceiverAccounts);
  const transactionAccountExclusions = normalizeExpectedAccounts([
    ...(options.expectedReceiverAccounts || []),
    ...(options.transactionAccountExclusions || []),
  ]);
  const qrPayloads = await readQrPayloads(data);
  const qrPayload = selectSlipQrPayload(qrPayloads, transactionAccountExclusions) || qrPayloads[0];
  const easySlip = await verifySlipWithEasySlip({
    data,
    contentType: options.contentType,
    qrPayload,
    expectedAmount,
    paymentMethod: options.paymentMethod,
    remark: options.remark,
  });
  const easySlipData = easySlip.ok ? easySlip.data : undefined;
  const easySlipConfigured = easySlip.provider !== "none";
  const allowLocalEvidence = !easySlipConfigured || settings.easySlipAlwaysRunLocalOcr;
  const shouldRunLocalOcr = allowLocalEvidence && (!easySlip.ok || settings.easySlipAlwaysRunLocalOcr);
  let ocrText = shouldRunLocalOcr ? await readOcrText(data, settings.slipOcrLang, Number(settings.slipOcrMaxVariants)) : undefined;
  const easySlipText = easySlipData ? stringifyEasySlipSearchText(easySlipData) : "";
  const easySlipAmount = easySlipData ? extractEasySlipAmount(easySlipData) : undefined;
  const easySlipPayload = easySlipData?.rawSlip?.payload;
  const easySlipTransactionId = easySlipData ? extractEasySlipTransactionId(easySlipData) : undefined;
  const qrAmount = qrPayload ? extractEmvAmount(qrPayload) : undefined;
  let ocrAmount = extractAmountFromText(ocrText, expectedAmount);
  if (allowLocalEvidence && !easySlip.ok && options.paymentMethod === "truemoney" && typeof ocrAmount !== "number") {
    const fallbackOcrText = await readLegacyOcrText(data, settings.slipOcrLang);
    ocrText = mergeTextValues(ocrText, fallbackOcrText);
    ocrAmount = extractAmountFromText(ocrText, expectedAmount);
  }
  const localAmount = typeof qrAmount === "number" ? qrAmount : ocrAmount;
  const detectedAmount = typeof easySlipAmount === "number" ? easySlipAmount : allowLocalEvidence ? localAmount : undefined;
  const amountSource = typeof easySlipAmount === "number" ? "easyslip" : allowLocalEvidence && typeof qrAmount === "number" ? "qr" : allowLocalEvidence && typeof ocrAmount === "number" ? "ocr" : null;
  const expectedReceiverName = options.expectedReceiverName?.trim();
  const searchableText = [easySlipText, allowLocalEvidence ? qrPayload : undefined, ocrText].filter(Boolean).join("\n");
  const receiverSearchableText = options.paymentMethod === "truemoney"
    ? [easySlipText, ocrText].filter(Boolean).join("\n")
    : searchableText;
  const rawDetectedReceiverName = extractEasySlipReceiverName(easySlipData) || extractReceiverNameFromText(ocrText, options.paymentMethod);
  const amountMatches =
    typeof easySlipData?.isAmountMatched === "boolean"
      ? easySlipData.isAmountMatched
      : typeof detectedAmount === "number" && Number.isFinite(expectedAmount) && expectedAmount > 0
        ? Math.abs(detectedAmount - expectedAmount) < 0.01
        : null;
  const easySlipAccountMatched = easySlipData ? hasEasySlipMatchedAccount(easySlipData) : false;
  const receiverAccountMatches = easySlipAccountMatched
    ? true
    : receiverSearchableText && expectedAccounts.length > 0
      ? containsExpectedAccount(receiverSearchableText, expectedAccounts)
      : null;
  const receiverNameMatches = receiverSearchableText && expectedReceiverName
    ? containsExpectedName([receiverSearchableText, rawDetectedReceiverName].filter(Boolean).join("\n"), expectedReceiverName)
    : null;
  const detectedReceiverName = receiverNameMatches === true && expectedReceiverName
    ? expectedReceiverName
    : rawDetectedReceiverName;
  const slipTransactionId = easySlipTransactionId || (
    allowLocalEvidence && qrPayload
      ? extractSlipTransactionId(qrPayload, transactionAccountExclusions, qrAmount)
      : undefined
  );

  return {
    imageHash,
    qrPayload: easySlipPayload || qrPayload,
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
    provider: easySlip.ok ? "easyslip" : "local",
    easySlipMethod: easySlip.provider === "easyslip" ? easySlip.method : undefined,
    easySlipVerified: easySlip.ok,
    easySlipDuplicate: Boolean(easySlipData?.isDuplicate),
    easySlipError: easySlip.ok || easySlip.provider === "none" ? undefined : `${easySlip.code || easySlip.status}: ${easySlip.message}`,
  };
}

async function readQrPayloads(data: Buffer) {
  try {
    const metadata = await sharp(data).rotate().metadata();
    const buffers: Buffer[] = [data];

    if (metadata.width && metadata.height && metadata.height > metadata.width * 1.6) {
      const sliceHeight = Math.min(metadata.height, Math.max(metadata.width, Math.round(metadata.height * 0.28)));
      const step = Math.max(1, Math.round(sliceHeight * 0.55));
      for (let top = 0; top < metadata.height; top += step) {
        const height = Math.min(sliceHeight, metadata.height - top);
        if (height < metadata.width * 0.4) continue;
        buffers.push(
          await sharp(data)
            .rotate()
            .extract({ left: 0, top, width: metadata.width, height })
            .png()
            .toBuffer()
        );
        if (top + sliceHeight >= metadata.height) break;
      }
    }

    const payloads = await Promise.all(buffers.map(readSingleQrPayload));
    return Array.from(new Set(payloads.filter((payload): payload is string => Boolean(payload))));
  } catch (error) {
    console.error("Failed to read slip QR payload", error);
    return [];
  }
}

async function readSingleQrPayload(data: Buffer) {
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

async function readOcrText(data: Buffer, lang = "eng+tha", maxVariantOverride?: number) {
  try {
    const langPath = ensureLocalTessdata(lang);
    const variants = await buildOcrVariants(data);
    const maxVariants = getOcrMaxVariants(maxVariantOverride);
    const selectedVariants = variants.slice(0, maxVariants);
    const results = await runOcrVariants(selectedVariants, lang, langPath);

    const recognizedBlocks = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => ({
        confidence: Number(result.value.data.confidence) || 0,
        text: result.value.data.text.trim(),
      }))
      .filter((result) => result.text);
    const text = mergeOcrTextBlocks(recognizedBlocks);

    if (text) return text;

    const firstError = results.find((result) => result.status === "rejected");
    if (firstError?.status === "rejected") {
      console.error("Failed to read slip OCR text", firstError.reason);
    }
    return undefined;
  } catch (error) {
    console.error("Failed to read slip OCR text", error);
    return undefined;
  }
}

async function readLegacyOcrText(data: Buffer, lang = "eng+tha") {
  try {
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
    const enlarged = await sharp(data)
      .rotate()
      .resize({ width: 2600, withoutEnlargement: false })
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
    const buffers = [prepared, enlarged, topCrop, middleCrop].filter((buffer): buffer is Buffer => Boolean(buffer));
    const results = await Promise.allSettled(
      buffers.map((buffer) => recognize(buffer, lang, createOcrOptions(langPath)))
    );

    const text = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value.data.text.trim())
      .filter(Boolean)
      .join("\n");
    if (text) return text;

    const firstError = results.find((result) => result.status === "rejected");
    if (firstError?.status === "rejected") {
      console.error("Failed to read slip legacy OCR text", firstError.reason);
    }
    return undefined;
  } catch (error) {
    console.error("Failed to read slip legacy OCR text", error);
    return undefined;
  }
}

function mergeTextValues(...values: Array<string | undefined>) {
  const cleanValues = values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return cleanValues.length > 0 ? cleanValues.join("\n") : undefined;
}

type OcrVariant = {
  name: string;
  buffer: Buffer;
  psm: "4" | "6" | "11" | "12";
};

async function buildOcrVariants(data: Buffer): Promise<OcrVariant[]> {
  const metadata = await sharp(data).rotate().metadata();
  const variants: Array<Promise<OcrVariant | undefined>> = [
    makeOcrVariant(data, "full-normal", "6", { width: 1800, normalize: true, sharpen: true }),
    makeOcrVariant(data, "full-large", "6", { width: 2600, normalize: true, sharpen: true, enlarge: true }),
    makeOcrVariant(data, "full-sparse", "11", { width: 2200, normalize: true, sharpen: true }),
    makeOcrVariant(data, "full-threshold", "6", { width: 2200, normalize: true, sharpen: true, threshold: 172 }),
  ];

  if (metadata.width && metadata.height) {
    variants.push(
      makeOcrVariant(data, "top-normal", "6", {
        crop: cropByRatio(metadata.width, metadata.height, 0, 0, 1, 0.34),
        width: 2500,
        normalize: true,
        sharpen: true,
        enlarge: true,
      }),
      makeOcrVariant(data, "top-threshold", "6", {
        crop: cropByRatio(metadata.width, metadata.height, 0, 0, 1, 0.34),
        width: 2500,
        normalize: true,
        sharpen: true,
        threshold: 170,
        enlarge: true,
      }),
      makeOcrVariant(data, "middle-normal", "6", {
        crop: cropByRatio(metadata.width, metadata.height, 0, 0.12, 1, 0.58),
        width: 2500,
        normalize: true,
        sharpen: true,
        enlarge: true,
      }),
      makeOcrVariant(data, "middle-sparse", "11", {
        crop: cropByRatio(metadata.width, metadata.height, 0, 0.12, 1, 0.58),
        width: 2500,
        normalize: true,
        sharpen: true,
        enlarge: true,
      }),
      makeOcrVariant(data, "lower-normal", "6", {
        crop: cropByRatio(metadata.width, metadata.height, 0, 0.45, 1, 0.5),
        width: 2400,
        normalize: true,
        sharpen: true,
        enlarge: true,
      }),
      makeOcrVariant(data, "right-detail", "11", {
        crop: cropByRatio(metadata.width, metadata.height, 0.28, 0, 0.72, 0.72),
        width: 2200,
        normalize: true,
        sharpen: true,
        enlarge: true,
      })
    );
  }

  const resolved = await Promise.all(variants);
  return resolved.filter((variant): variant is OcrVariant => Boolean(variant));
}

type OcrImageOptions = {
  crop?: sharp.Region;
  width: number;
  normalize?: boolean;
  sharpen?: boolean;
  threshold?: number;
  enlarge?: boolean;
};

async function makeOcrVariant(
  data: Buffer,
  name: string,
  psm: OcrVariant["psm"],
  options: OcrImageOptions
) {
  try {
    let pipeline = sharp(data).rotate();
    if (options.crop) pipeline = pipeline.extract(options.crop);
    pipeline = pipeline
      .resize({ width: options.width, withoutEnlargement: !options.enlarge })
      .grayscale();
    if (options.normalize) pipeline = pipeline.normalize();
    if (options.sharpen) pipeline = pipeline.sharpen({ sigma: 1.1, m1: 1.4, m2: 0.7 });
    if (typeof options.threshold === "number") pipeline = pipeline.threshold(options.threshold);
    const buffer = await pipeline.png().toBuffer();
    return { name, buffer, psm };
  } catch (error) {
    console.error(`Failed to prepare OCR variant ${name}`, error);
    return undefined;
  }
}

function cropByRatio(width: number, height: number, left: number, top: number, cropWidth: number, cropHeight: number) {
  const cropLeft = Math.max(0, Math.min(width - 1, Math.round(width * left)));
  const cropTop = Math.max(0, Math.min(height - 1, Math.round(height * top)));
  return {
    left: cropLeft,
    top: cropTop,
    width: Math.max(1, Math.min(width - cropLeft, Math.round(width * cropWidth))),
    height: Math.max(1, Math.min(height - cropTop, Math.round(height * cropHeight))),
  };
}

async function runOcrVariants(variants: OcrVariant[], lang: string, langPath: string) {
  const results: Array<PromiseSettledResult<{ data: { confidence: number; text: string } }>> = [];

  for (let index = 0; index < variants.length; index += OCR_BATCH_SIZE) {
    const batch = variants.slice(index, index + OCR_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((variant) => recognize(variant.buffer, lang, createOcrOptions(langPath, variant.psm)))
    );
    results.push(...batchResults);
  }

  return results;
}

function mergeOcrTextBlocks(blocks: Array<{ confidence: number; text: string }>) {
  const lines = blocks
    .sort((a, b) => b.confidence - a.confidence)
    .flatMap((block) => block.text.split(/\r?\n/))
    .map(cleanOcrLine)
    .map(normalizeCommonOcrMistakes)
    .filter(Boolean);
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const key = normalizeTextForSearch(line);
    if (!key || seen.has(key)) continue;
    if (merged.some((existing) => {
      const existingKey = normalizeTextForSearch(existing);
      return existingKey.length > 8 && (existingKey.includes(key) || key.includes(existingKey));
    })) {
      continue;
    }

    seen.add(key);
    merged.push(line);
  }

  return merged.join("\n");
}

function normalizeCommonOcrMistakes(value: string) {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[๐-๙]/g, (char) => String(char.charCodeAt(0) - "๐".charCodeAt(0)))
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getOcrMaxVariants(override?: number) {
  const value = Number(override || DEFAULT_OCR_MAX_VARIANTS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_OCR_MAX_VARIANTS;
}

function createOcrOptions(langPath: string, psm: OcrVariant["psm"] = "6") {
  const require = createRequire(import.meta.url);

  return {
    workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
    langPath,
    cachePath: langPath,
    cacheMethod: "none" as const,
    tessedit_pageseg_mode: psm,
    tessedit_ocr_engine_mode: "1",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
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
  if (!["eng", "tha"].includes(lang)) {
    throw new Error(`Unsupported OCR language "${lang}". Supported values are "eng" and "tha".`);
  }

  const require = createRequire(import.meta.url);
  const filename = `${lang}.traineddata.gz`;
  const packageName = `@tesseract.js-data/${lang}`;
  const packageDir = lang === "eng"
    ? path.dirname(require.resolve("@tesseract.js-data/eng/package.json"))
    : path.dirname(require.resolve("@tesseract.js-data/tha/package.json"));
  const indexDir = lang === "eng"
    ? path.dirname(require.resolve("@tesseract.js-data/eng"))
    : path.dirname(require.resolve("@tesseract.js-data/tha"));
  const candidates = [
    path.join(process.cwd(), "node_modules", packageName, "4.0.0", filename),
    process.env.LAMBDA_TASK_ROOT
      ? path.join(process.env.LAMBDA_TASK_ROOT, "node_modules", packageName, "4.0.0", filename)
      : "",
    path.join(packageDir, "4.0.0", filename),
    path.join(indexDir, "4.0.0", filename),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Missing OCR language data for "${lang}". Checked: ${candidates.join(", ")}`);
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

  const normalizedText = normalizeCommonOcrMistakes(text)
    .replace(/[|]/g, " ")
    .replace(/([0-9])\s+([0-9]{2})(?=\s*(?:บาท|฿|baht|thb))/giu, "$1.$2");
  const candidates: Array<{ value: number; score: number }> = [];
  const amountRegex = /(?:จำนวนเงิน|ยอดเงิน|ยอดโอน|ยอด|amount|total|transfer|paid|บาท|฿)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(?:บาท|฿|baht|thb)?/giu;

  for (const match of normalizedText.matchAll(amountRegex)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0 || value > 100000) continue;

    const contextStart = Math.max(0, (match.index || 0) - 18);
    const contextEnd = Math.min(normalizedText.length, (match.index || 0) + match[0].length + 18);
    const context = normalizedText.slice(contextStart, contextEnd);
    const amountWordScore = /จำนวนเงิน|ยอดเงิน|ยอดโอน|ยอด|amount|total|transfer|paid|บาท|฿|baht|thb/i.test(context) ? 25 : 0;
    const expectedScore = Number.isFinite(expectedAmount) && expectedAmount > 0 && Math.abs(value - expectedAmount) < 0.01 ? 30 : 0;
    const nearExpectedScore = Number.isFinite(expectedAmount) && expectedAmount > 0 && Math.abs(value - expectedAmount) <= 1 ? 8 : 0;
    const decimalScore = /\.[0-9]{2}/.test(match[1]) ? 4 : 0;
    const datePenalty = /วันที่|date|เวลา|time|[0-3]?[0-9][\/-][01]?[0-9]/i.test(context) ? -20 : 0;
    candidates.push({ value, score: amountWordScore + expectedScore + nearExpectedScore + decimalScore + datePenalty });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value;
}

function extractEasySlipAmount(data: EasySlipVerifyData) {
  if (typeof data.amountInSlip === "number") return data.amountInSlip;

  const rawAmount = data.rawSlip?.amount;
  if (typeof rawAmount === "number") return rawAmount;
  if (typeof rawAmount?.amount === "number") return rawAmount.amount;
  if (typeof rawAmount?.local?.amount === "number") return rawAmount.local.amount;
  return undefined;
}

function extractEasySlipTransactionId(data: EasySlipVerifyData) {
  const value = data.rawSlip?.transRef || data.rawSlip?.transactionId;
  return value ? cleanTransactionCandidate(value) : undefined;
}

function extractEasySlipReceiverName(data: EasySlipVerifyData | undefined) {
  if (!data?.rawSlip?.receiver || typeof data.rawSlip.receiver !== "object") return undefined;
  const receiver = data.rawSlip.receiver as Record<string, unknown>;
  const directName = stringValue(receiver.name);
  if (directName) return directName;

  const account = typeof receiver.account === "object" && receiver.account
    ? receiver.account as Record<string, unknown>
    : undefined;
  const name = account?.name;

  if (typeof name === "string") return name;
  if (typeof name === "object" && name) {
    const names = name as Record<string, unknown>;
    return stringValue(names.th) || stringValue(names.en);
  }

  return undefined;
}

function stringifyEasySlipSearchText(data: EasySlipVerifyData) {
  const values = collectPrimitiveValues({
    matchedAccount: data.matchedAccount,
    rawSlip: data.rawSlip,
  });
  return values.join("\n");
}

function hasEasySlipMatchedAccount(data: EasySlipVerifyData) {
  return Boolean(data.matchedAccount && typeof data.matchedAccount === "object");
}

function collectPrimitiveValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectPrimitiveValues);
  if (typeof value === "object" && value) {
    return Object.values(value as Record<string, unknown>).flatMap(collectPrimitiveValues);
  }
  return [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function selectSlipQrPayload(payloads: string[], expectedAccounts: ExpectedReceiverAccount[]) {
  if (payloads.length <= 1) return payloads[0];

  return payloads
    .map((payload, index) => {
      const transactionId = extractSlipTransactionId(payload, expectedAccounts, extractEmvAmount(payload));
      const score =
        (transactionId ? 60 : 0) +
        (/P2P/i.test(payload) ? 40 : 0) +
        (isGeneratedPaymentQr(payload, expectedAccounts) ? -80 : 0) -
        index;
      return { payload, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.payload;
}

function isGeneratedPaymentQr(payload: string, expectedAccounts: ExpectedReceiverAccount[]) {
  const payloadDigits = normalizeDigits(payload);
  return (
    payload.includes("A000000677010111") &&
    expectedAccounts.some((account) => account.digits.length >= 4 && payloadDigits.includes(account.digits))
  );
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
  if (/5802TH6304[0-9A-F]{4}$/i.test(candidate)) return false;

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

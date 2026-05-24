import "server-only";

import { put } from "@vercel/blob";
import { getRuntimeSettings } from "@/lib/server/appSettings";

export function appUploadUrl(pathname: string) {
  return `/api/uploads?pathname=${encodeURIComponent(pathname)}`;
}

export async function storePaymentProofImage({
  requestId,
  contentType,
  data,
}: {
  requestId: string;
  contentType: string;
  data: ArrayBuffer;
}) {
  const extension = extensionFromContentType(contentType);
  const pathname = `payment-slips/${requestId}-${Date.now()}${extension}`;
  const token = (await getRuntimeSettings()).blobReadWriteToken || undefined;
  const blob = await put(pathname, Buffer.from(data), {
    access: "private",
    contentType: contentType || "image/jpeg",
    allowOverwrite: true,
    token,
  });

  return {
    pathname: blob.pathname,
    url: appUploadUrl(blob.pathname),
  };
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

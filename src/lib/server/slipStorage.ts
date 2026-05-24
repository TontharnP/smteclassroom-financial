import "server-only";

import { getRuntimeSettings } from "@/lib/server/appSettings";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const DEFAULT_SLIP_BUCKET = "payment-slips";

export async function getSlipBucketName() {
  return (await getRuntimeSettings()).supabaseSlipBucket || DEFAULT_SLIP_BUCKET;
}

export function appSlipUrl(pathname: string) {
  return `/api/uploads/slips?path=${encodeURIComponent(pathname)}`;
}

export async function storeSlipImage({
  requestId,
  contentType,
  data,
}: {
  requestId: string;
  contentType: string;
  data: Buffer;
}) {
  const extension = extensionFromContentType(contentType);
  const pathname = `${requestId}-${Date.now()}${extension}`;
  const bucket = await getSlipBucketName();
  const { error } = await getSupabaseAdmin()
    .storage
    .from(bucket)
    .upload(pathname, data, {
      contentType: contentType || "image/jpeg",
      upsert: true,
    });

  if (error) throw error;

  return {
    pathname,
    url: appSlipUrl(pathname),
  };
}

export async function downloadSlipImage(pathname: string) {
  const { data, error } = await getSupabaseAdmin()
    .storage
    .from(await getSlipBucketName())
    .download(pathname);

  if (error) throw error;
  return data;
}

export async function deleteSlipImages(pathnames: string[]) {
  const cleanPathnames = pathnames.filter(Boolean);
  if (cleanPathnames.length === 0) return;

  const { error } = await getSupabaseAdmin()
    .storage
    .from(await getSlipBucketName())
    .remove(cleanPathnames);

  if (error) throw error;
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

import { del, get, put } from "@vercel/blob";
import { badRequest, noContent, notFound, ok, serverError } from "@/lib/api/response";
import { getRuntimeSettings } from "@/lib/server/appSettings";

const uploadFolders = {
  student: "avatars",
  category: "category-icons",
} as const;

type UploadKind = keyof typeof uploadFolders;

function isUploadKind(value: FormDataEntryValue | null): value is UploadKind {
  return value === "student" || value === "category";
}

function extensionFromName(name: string) {
  const extension = name.split(".").pop();
  return extension ? `.${extension}` : "";
}

function appUploadUrl(pathname: string) {
  return `/api/uploads?pathname=${encodeURIComponent(pathname)}`;
}

function pathnameFromStoredUrl(value: string) {
  try {
    const url = new URL(value, "http://local");
    const pathname = url.searchParams.get("pathname");
    if (url.pathname === "/api/uploads" && pathname) return pathname;
  } catch {
    // Keep falling through for raw URLs/pathnames.
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pathname = url.searchParams.get("pathname");
    if (!pathname) return badRequest("pathname is required");

    const token = (await getRuntimeSettings()).blobReadWriteToken || undefined;
    const blob = await get(pathname, { access: "private", token });
    if (!blob?.stream) return notFound("File not found");

    const headers = new Headers();
    blob.headers.forEach((value, key) => headers.set(key, value));
    headers.set("Cache-Control", "private, max-age=300");
    if (blob.blob.contentType) headers.set("Content-Type", blob.blob.contentType);

    return new Response(blob.stream, {
      status: 200,
      headers,
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = formData.get("kind");
    const ownerId = formData.get("ownerId");

    if (!(file instanceof File)) return badRequest("A file is required");
    if (!isUploadKind(kind)) return badRequest("Upload kind must be student or category");
    if (typeof ownerId !== "string" || !ownerId) return badRequest("ownerId is required");

    const pathname = `${uploadFolders[kind]}/${ownerId}-${Date.now()}${extensionFromName(file.name)}`;
    const token = (await getRuntimeSettings()).blobReadWriteToken || undefined;
    const blob = await put(pathname, file, {
      access: "private",
      contentType: file.type || undefined,
      allowOverwrite: true,
      token,
    });

    return ok({ url: appUploadUrl(blob.pathname), pathname: blob.pathname }, 201);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    if (!body.url) return badRequest("url is required");
    const token = (await getRuntimeSettings()).blobReadWriteToken || undefined;
    await del(pathnameFromStoredUrl(body.url), { token });
    return noContent();
  } catch (error) {
    return serverError(error);
  }
}

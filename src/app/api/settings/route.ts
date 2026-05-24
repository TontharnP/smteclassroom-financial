import { badRequest, ok, serverError } from "@/lib/api/response";
import { getRuntimeSettings, savePublicSettings } from "@/lib/server/appSettings";
import { sanitizePublicSettings } from "@/lib/settings/schema";

export async function GET() {
  try {
    return ok(await getRuntimeSettings());
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("Invalid settings payload");
    const settings = sanitizePublicSettings(body);
    return ok(await savePublicSettings(settings));
  } catch (error) {
    return serverError(error);
  }
}

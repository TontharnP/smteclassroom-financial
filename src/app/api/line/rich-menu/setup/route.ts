import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { badRequest, ok, serverError } from "@/lib/api/response";
import { listRecords, type Row } from "@/lib/supabase/server";
import { linkLineRichMenu } from "@/lib/server/line";
import { getRuntimeSettings } from "@/lib/server/appSettings";
import type { AppPublicSettings } from "@/lib/settings/schema";

const RICH_MENU_SIZE = { width: 1200, height: 405 };
const MAX_RICH_MENU_IMAGE_BYTES = 1024 * 1024;
const RICH_MENU_IMAGE_CONTENT_TYPE = "image/png";
const LEGACY_RICH_MENU_NAMES = new Set(["Classroom Finance Menu", "Classroom Finance Register Menu", "Classroom Finance Student Menu"]);

type RichMenuDefinition = {
  key: "register" | "registered";
  name: string;
  imagePath: string;
  areas: Array<{
    bounds: { x: number; y: number; width: number; height: number };
    action: { type: "message"; label: string; text: string };
  }>;
};

type LineRichMenuSummary = {
  richMenuId?: string;
  name?: string;
};

function buildRichMenus(settings: AppPublicSettings): RichMenuDefinition[] {
  return [{
    key: "register",
    name: settings.lineRegisterRichMenuName,
    imagePath: join(process.cwd(), "public/line/rich-menu-register.png"),
    areas: [
      {
        bounds: { x: 0, y: 0, width: RICH_MENU_SIZE.width, height: RICH_MENU_SIZE.height },
        action: { type: "message", label: settings.lineRegisterAction.label, text: settings.lineRegisterAction.text },
      },
    ],
  },
  {
    key: "registered",
    name: settings.lineRegisteredRichMenuName,
    imagePath: join(process.cwd(), "public/line/rich-menu-registered.png"),
    areas: [
      {
        bounds: { x: 0, y: 0, width: 300, height: RICH_MENU_SIZE.height },
        action: { type: "message", label: settings.linePayAction.label, text: settings.linePayAction.text },
      },
      {
        bounds: { x: 300, y: 0, width: 300, height: RICH_MENU_SIZE.height },
        action: { type: "message", label: settings.lineStatusAction.label, text: settings.lineStatusAction.text },
      },
      {
        bounds: { x: 600, y: 0, width: 300, height: RICH_MENU_SIZE.height },
        action: { type: "message", label: settings.lineHistoryAction.label, text: settings.lineHistoryAction.text },
      },
      {
        bounds: { x: 900, y: 0, width: 300, height: RICH_MENU_SIZE.height },
        action: { type: "message", label: settings.lineTotalAction.label, text: settings.lineTotalAction.text },
      },
    ],
  }];
}

export async function POST() {
  const createdMenuIds: string[] = [];
  let token: string | undefined;

  try {
    const settings = await getRuntimeSettings();
    token = settings.lineChannelAccessToken;
    if (!token) return badRequest("Missing LINE_CHANNEL_ACCESS_TOKEN");
    const richMenus = buildRichMenus(settings);

    await deleteExistingProjectMenus(token, richMenus);

    const result: Record<RichMenuDefinition["key"], string> = {
      register: "",
      registered: "",
    };

    for (const menu of richMenus) {
      const richMenuId = await createRichMenu(token, menu, settings.lineRichMenuChatBarText);
      createdMenuIds.push(richMenuId);
      await uploadRichMenuImage(token, richMenuId, menu.imagePath);
      result[menu.key] = richMenuId;
    }

    await setDefaultRichMenu(token, result.register);
    const linkedRegisteredUsers = await linkRegisteredStudents(result.registered);

    return ok({
      registerRichMenuId: result.register,
      registeredRichMenuId: result.registered,
      linkedRegisteredUsers,
      note: "Register menu is default. Registered students are linked to the student menu.",
    });
  } catch (error) {
    await Promise.all(createdMenuIds.map((richMenuId) => deleteRichMenu(token, richMenuId)));
    return serverError(error);
  }
}

async function createRichMenu(token: string, menu: RichMenuDefinition, chatBarText: string) {
  const response = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      size: RICH_MENU_SIZE,
      selected: true,
      name: menu.name,
      chatBarText,
      areas: menu.areas,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`LINE rich menu API ${response.status}: ${JSON.stringify(body)}`);
  if (!body?.richMenuId) throw new Error("LINE did not return richMenuId");
  return String(body.richMenuId);
}

async function uploadRichMenuImage(token: string, richMenuId: string, imagePath: string) {
  const data = await readFile(imagePath);
  if (data.byteLength > MAX_RICH_MENU_IMAGE_BYTES) {
    throw new Error(`LINE rich menu image is too large (${formatBytes(data.byteLength)}). Use PNG under ${formatBytes(MAX_RICH_MENU_IMAGE_BYTES)}.`);
  }

  const imageBody = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const response = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": RICH_MENU_IMAGE_CONTENT_TYPE,
    },
    body: imageBody,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE rich menu image API ${response.status}${body ? `: ${body}` : ""}`);
  }
}

async function deleteExistingProjectMenus(token: string, richMenus: RichMenuDefinition[]) {
  const response = await fetch("https://api.line.me/v2/bot/richmenu/list", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return;

  const body = await response.json().catch(() => null);
  const menus: LineRichMenuSummary[] = Array.isArray(body?.richmenus) ? body.richmenus : [];
  await Promise.all(
    menus
      .filter((menu) => richMenus.some((definition) => definition.name === menu.name) || LEGACY_RICH_MENU_NAMES.has(String(menu.name)))
      .map((menu) => deleteRichMenu(token, String(menu.richMenuId)))
  );
}

async function linkRegisteredStudents(registeredRichMenuId: string) {
  const students = await listRecords<Row>("students");
  const lineUserIds = [...new Set(students.map((student) => student.line_user_id).filter((id): id is string => typeof id === "string" && id.length > 0))];
  const results = await Promise.all(lineUserIds.map((lineUserId) => linkLineRichMenu(lineUserId, registeredRichMenuId)));
  return results.filter((result) => result.ok).length;
}

async function deleteRichMenu(token: string | undefined, richMenuId: string) {
  if (!token) return;

  await fetch(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function setDefaultRichMenu(token: string, richMenuId: string) {
  const response = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE default rich menu API ${response.status}${body ? `: ${body}` : ""}`);
  }
}

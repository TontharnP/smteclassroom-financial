import "server-only";

import { getRuntimeSettings } from "@/lib/server/appSettings";

type LineRichMenuSummary = {
  richMenuId?: string;
  name?: string;
};

export async function pushLineText(lineUserId: string | undefined, text: string) {
  return pushLineMessages(lineUserId, [{ type: "text", text }]);
}

export async function pushLineMessages(lineUserId: string | undefined, messages: Record<string, unknown>[]) {
  const token = (await getRuntimeSettings()).lineChannelAccessToken;
  if (!token || !lineUserId) return { ok: false, error: "Missing LINE token or user id" };

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      to: lineUserId,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `LINE push API ${response.status}${body ? `: ${body}` : ""}` };
  }

  return { ok: true };
}

export async function linkLineRichMenu(lineUserId: string | undefined, richMenuId: string | undefined) {
  const token = (await getRuntimeSettings()).lineChannelAccessToken;
  if (!token || !lineUserId || !richMenuId) return { ok: false, error: "Missing LINE token, user id, or rich menu id" };

  const response = await fetch(`https://api.line.me/v2/bot/user/${lineUserId}/richmenu/${richMenuId}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `LINE link rich menu API ${response.status}${body ? `: ${body}` : ""}` };
  }

  return { ok: true };
}

export async function linkLineRichMenuByName(lineUserId: string | undefined, richMenuName: string) {
  const token = (await getRuntimeSettings()).lineChannelAccessToken;
  if (!token || !lineUserId) return { ok: false, error: "Missing LINE token or user id" };

  const listResponse = await fetch("https://api.line.me/v2/bot/richmenu/list", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!listResponse.ok) {
    const body = await listResponse.text().catch(() => "");
    return { ok: false, error: `LINE rich menu list API ${listResponse.status}${body ? `: ${body}` : ""}` };
  }

  const body = await listResponse.json().catch(() => null);
  const menus: LineRichMenuSummary[] = Array.isArray(body?.richmenus) ? body.richmenus : [];
  const menu = menus.find((item) => item?.name === richMenuName);
  if (!menu?.richMenuId) return { ok: false, error: `Rich menu "${richMenuName}" not found` };

  return linkLineRichMenu(lineUserId, String(menu.richMenuId));
}

export async function unlinkLineRichMenu(lineUserId: string | undefined) {
  const token = (await getRuntimeSettings()).lineChannelAccessToken;
  if (!token || !lineUserId) return { ok: false, error: "Missing LINE token or user id" };

  const response = await fetch(`https://api.line.me/v2/bot/user/${lineUserId}/richmenu`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `LINE unlink rich menu API ${response.status}${body ? `: ${body}` : ""}` };
  }

  return { ok: true };
}

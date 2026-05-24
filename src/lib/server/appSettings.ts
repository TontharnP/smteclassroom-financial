import "server-only";

import { getSupabaseAdmin, isMissingTableError, type Row } from "@/lib/supabase/server";
import {
  DEFAULT_LINE_MESSAGES,
  DEFAULT_PUBLIC_SETTINGS,
  type AppPublicSettings,
  type LineMessageKey,
  mergePublicSettings,
  sanitizePublicSettings,
} from "@/lib/settings/schema";

const PUBLIC_CONFIG_KEY = "public_config";

export async function getPublicSettings() {
  return readPublicSettings();
}

export async function getRuntimeSettings() {
  const settings = await getPublicSettings();
  return withEnvironmentFallbacks(settings);
}

export async function savePublicSettings(input: unknown) {
  const settings = sanitizePublicSettings(input);
  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert({
      key: PUBLIC_CONFIG_KEY,
      value: settings as unknown as Row,
      description: "Editable runtime application settings for final handoff version.",
    }, {
      onConflict: "key",
    });

  if (error) throw error;
  return settings;
}

export async function lineMessage(
  key: LineMessageKey,
  variables: Record<string, string | number | undefined | null> = {}
) {
  const settings = await getPublicSettings();
  const template = settings.lineMessages[key] || DEFAULT_LINE_MESSAGES[key];
  return renderTemplate(template, variables);
}

export function configuredValue(settingValue: string | undefined, envName: string, fallback = "") {
  return settingValue?.trim() || process.env[envName]?.trim() || fallback;
}

function withEnvironmentFallbacks(settings: AppPublicSettings): AppPublicSettings {
  return {
    ...settings,
    supabaseUrl: configuredValue(settings.supabaseUrl, "SUPABASE_URL"),
    supabaseServiceRoleKey: configuredValue(settings.supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"),
    lineChannelAccessToken: configuredValue(settings.lineChannelAccessToken, "LINE_CHANNEL_ACCESS_TOKEN"),
    lineChannelSecret: configuredValue(settings.lineChannelSecret, "LINE_CHANNEL_SECRET"),
    easySlipApiKey: configuredValue(settings.easySlipApiKey, "EASYSLIP_API_KEY"),
    easySlipCheckDuplicate: settings.easySlipCheckDuplicate,
    easySlipMatchAccount: settings.easySlipMatchAccount,
    easySlipAlwaysRunLocalOcr: settings.easySlipAlwaysRunLocalOcr,
    slipAutoRejectInvalidImage: settings.slipAutoRejectInvalidImage,
    trueMoneyAutoRejectReceiverMismatch: settings.trueMoneyAutoRejectReceiverMismatch,
    slipOcrLang: configuredValue(settings.slipOcrLang, "SLIP_OCR_LANG", DEFAULT_PUBLIC_SETTINGS.slipOcrLang),
    slipOcrMaxVariants: configuredValue(settings.slipOcrMaxVariants, "SLIP_OCR_MAX_VARIANTS", DEFAULT_PUBLIC_SETTINGS.slipOcrMaxVariants),
    supabaseSlipBucket: configuredValue(settings.supabaseSlipBucket, "SUPABASE_SLIP_BUCKET", DEFAULT_PUBLIC_SETTINGS.supabaseSlipBucket),
    blobReadWriteToken: configuredValue(settings.blobReadWriteToken, "BLOB_READ_WRITE_TOKEN"),
    bankReceiverName: configuredValue(settings.bankReceiverName, "SLIP_RECEIVER_ACCOUNT_NAME"),
    bankReceiverAccount: configuredValue(settings.bankReceiverAccount, "SLIP_RECEIVER_ACCOUNT_NUMBER"),
    trueMoneyReceiverName: configuredValue(settings.trueMoneyReceiverName, "TRUEMONEY_RECEIVER_ACCOUNT_NAME", configuredValue(settings.bankReceiverName, "SLIP_RECEIVER_ACCOUNT_NAME")),
    trueMoneyReceiverPhone: configuredValue(settings.trueMoneyReceiverPhone, "TRUEMONEY_RECEIVER_ACCOUNT_NUMBER"),
  };
}

export function renderTemplate(template: string, variables: Record<string, string | number | undefined | null>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const value = variables[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

async function readPublicSettings() {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", PUBLIC_CONFIG_KEY)
      .maybeSingle();

    if (error) throw error;
    return mergePublicSettings(data?.value);
  } catch (error) {
    if (isMissingTableError(error, "app_settings")) {
      return DEFAULT_PUBLIC_SETTINGS;
    }
    throw error;
  }
}

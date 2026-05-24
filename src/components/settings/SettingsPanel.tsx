"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { CheckCircle2, Clipboard, Eye, EyeOff, FileDown, FileUp, MessageSquareText, RefreshCcw, RotateCcw, Save, Search, Settings2, ShieldAlert, Sparkles, WalletCards } from "lucide-react";
import { apiRequest } from "@/lib/api/client";
import {
  DEFAULT_PUBLIC_SETTINGS,
  type AppPublicSettings,
  type LineMessageKey,
  type RichMenuActionSettings,
  sanitizePublicSettings,
} from "@/lib/settings/schema";

type SettingsSection = "setup" | "app" | "secrets" | "payment" | "slip" | "richMenu" | "line";

const SECTIONS: Array<{ key: SettingsSection; label: string; description: string; icon: ReactNode }> = [
  { key: "setup", label: "Setup Wizard", description: "กรอกค่าจำเป็นสำหรับส่งต่อ", icon: <Sparkles className="h-5 w-5" /> },
  { key: "app", label: "ข้อมูลระบบ", description: "ชื่อระบบ ห้อง และผู้ดูแล", icon: <Settings2 className="h-5 w-5" /> },
  { key: "secrets", label: "Secrets/API", description: "LINE, Supabase, EasySlip, Blob", icon: <ShieldAlert className="h-5 w-5" /> },
  { key: "payment", label: "รับเงิน/QR", description: "PromptPay และ TrueMoney QR", icon: <WalletCards className="h-5 w-5" /> },
  { key: "slip", label: "Slip checker", description: "EasySlip และ OCR flags", icon: <CheckCircle2 className="h-5 w-5" /> },
  { key: "richMenu", label: "Rich Menu", description: "ชื่อเมนู ปุ่ม และ command", icon: <Clipboard className="h-5 w-5" /> },
  { key: "line", label: "ข้อความ LINE", description: "Template ตอบกลับทั้งหมด", icon: <MessageSquareText className="h-5 w-5" /> },
];

const LINE_MESSAGE_FIELDS: Array<{ key: LineMessageKey; label: string; hint: string }> = [
  { key: "alreadyRegistered", label: "ลงทะเบียนไว้แล้ว", hint: "{{studentName}}, {{studentNumber}}, {{menuStatus}}" },
  { key: "registrationIntro", label: "คำแนะนำลงทะเบียน", hint: "ข้อความเมื่อกด/พิมพ์ลงทะเบียน" },
  { key: "registrationNotFound", label: "ไม่พบนักเรียน", hint: "{{studentNumber}}" },
  { key: "registrationStudentTaken", label: "เลขที่มี LINE แล้ว", hint: "{{studentNumber}}" },
  { key: "registrationSuccess", label: "ลงทะเบียนสำเร็จ", hint: "{{studentName}}, {{studentNumber}}, {{menuStatus}}" },
  { key: "mustRegister", label: "ต้องลงทะเบียนก่อน", hint: "ใช้ก่อนเปิดเมนูชำระ/สถานะ" },
  { key: "paymentNotFound", label: "ไม่พบรายการชำระ", hint: "ใช้เมื่อ payment request หมดอายุ" },
  { key: "paymentWrongLineUser", label: "LINE ไม่ตรงรายการ", hint: "ข้อความความปลอดภัย" },
  { key: "invalidPaymentMethod", label: "วิธีชำระไม่ถูกต้อง", hint: "ใช้เมื่อ callback method ไม่ถูกต้อง" },
  { key: "cashPaymentReceived", label: "รับเรื่องเงินสด", hint: "ข้อความใน Flex เงินสด" },
  { key: "qrPaymentInstruction", label: "คำแนะนำหลังสแกน QR", hint: "ข้อความใน Flex QR" },
  { key: "noActiveSlipRequest", label: "ส่งสลิปโดยยังไม่มีรายการ", hint: "ใช้เมื่อไม่มี awaiting_slip" },
  { key: "slipAutoApproved", label: "สลิปผ่านอัตโนมัติ", hint: "หลัง auto approve" },
  { key: "slipAutoRejected", label: "สลิปถูกปฏิเสธอัตโนมัติ", hint: "{{reason}}" },
  { key: "slipDuplicateSuspected", label: "สงสัยสลิปซ้ำ", hint: "ส่งเข้า review" },
  { key: "slipPendingReview", label: "รับสลิปแล้วรอตรวจ", hint: "ส่งเข้า review" },
  { key: "paymentCancelEmpty", label: "ไม่มีรายการให้ยกเลิก", hint: "คำสั่งยกเลิก" },
  { key: "paymentCancelSuccess", label: "ยกเลิกสำเร็จ", hint: "คำสั่งยกเลิก" },
  { key: "lineApproved", label: "เหรัญญิกอนุมัติสลิป", hint: "push message หลังอนุมัติ" },
  { key: "lineRejected", label: "เหรัญญิกปฏิเสธสลิป", hint: "{{reason}}" },
  { key: "scheduleAnnouncementFooter", label: "ท้ายประกาศกำหนดการ", hint: "Flex แจ้งกำหนดการใหม่" },
  { key: "scheduleReminderFooter", label: "ท้ายแจ้งเตือนชำระ", hint: "Flex reminder" },
];

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("setup");
  const [settings, setSettings] = useState<AppPublicSettings>(DEFAULT_PUBLIC_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setupProgress = useMemo(() => {
    const required = [
      settings.supabaseUrl,
      settings.supabaseServiceRoleKey,
      settings.lineChannelAccessToken,
      settings.lineChannelSecret,
      settings.promptPayId,
      settings.easySlipApiKey,
    ];
    const done = required.filter((value) => value.trim()).length;
    return { done, total: required.length };
  }, [settings]);

  const filteredLineFields = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th-TH");
    if (!keyword) return LINE_MESSAGE_FIELDS;
    return LINE_MESSAGE_FIELDS.filter((field) =>
      [field.label, field.hint, field.key, settings.lineMessages[field.key] || ""]
        .join(" ")
        .toLocaleLowerCase("th-TH")
        .includes(keyword)
    );
  }, [search, settings.lineMessages]);

  useEffect(() => {
    let ignore = false;
    async function loadSettings() {
      setIsLoading(true);
      setError(null);
      try {
        const payload = await apiRequest<AppPublicSettings>("/api/settings");
        if (!ignore) setSettings(payload);
      } catch (loadError) {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "โหลดตั้งค่าไม่สำเร็จ");
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }

    loadSettings();
    return () => {
      ignore = true;
    };
  }, []);

  async function saveSettings() {
    setIsSaving(true);
    setError(null);
    try {
      const payload = await apiRequest<AppPublicSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(payload);
      toast.success("บันทึกตั้งค่าเรียบร้อย");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "บันทึกตั้งค่าไม่สำเร็จ";
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  function updateField<K extends keyof AppPublicSettings>(key: K, value: AppPublicSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateAction(key: keyof Pick<AppPublicSettings, "lineRegisterAction" | "linePayAction" | "lineStatusAction" | "lineHistoryAction" | "lineTotalAction">, part: keyof RichMenuActionSettings, value: string) {
    setSettings((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [part]: value,
      },
    }));
  }

  function updateLineMessage(key: LineMessageKey, value: string) {
    setSettings((current) => ({
      ...current,
      lineMessages: {
        ...current.lineMessages,
        [key]: value,
      },
    }));
  }

  function resetField<K extends keyof AppPublicSettings>(key: K) {
    updateField(key, DEFAULT_PUBLIC_SETTINGS[key]);
  }

  function resetLineMessage(key: LineMessageKey) {
    updateLineMessage(key, DEFAULT_PUBLIC_SETTINGS.lineMessages[key]);
  }

  function exportSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "classroom-finance-settings.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importSettings(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      setSettings(sanitizePublicSettings(JSON.parse(text)));
      toast.success("นำเข้า settings แล้ว กดบันทึกเพื่อใช้งาน");
    } catch {
      toast.error("ไฟล์ settings ไม่ถูกต้อง");
    }
  }

  if (isLoading) {
    return (
      <div className="apple-card p-6">
        <div className="h-5 w-48 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="apple-card h-fit p-3 lg:sticky lg:top-0">
        <div className="mb-3 rounded-3xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-950/30 dark:text-blue-100">
          ตั้งค่าจำเป็นแล้ว {setupProgress.done}/{setupProgress.total}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {SECTIONS.map((section) => (
            <SettingsNavItem
              key={section.key}
              active={activeSection === section.key}
              icon={section.icon}
              label={section.label}
              description={section.description}
              onClick={() => setActiveSection(section.key)}
            />
          ))}
        </div>
      </aside>

      <section className="apple-card min-h-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--line)" }}>
          <div>
            <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">{sectionTitle(activeSection)}</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">แก้ได้จากเว็บสำหรับเวอร์ชันส่งต่อรุ่นน้อง ค่า secrets จะถูกเก็บใน `app_settings`</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="apple-ghost-button inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold">
              <FileUp className="h-4 w-4" />
              Import
            </button>
            <button type="button" onClick={exportSettings} className="apple-ghost-button inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold">
              <FileDown className="h-4 w-4" />
              Export
            </button>
            <button type="button" onClick={saveSettings} disabled={isSaving} className="apple-button pressable inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60">
              {isSaving ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              บันทึก
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(event) => importSettings(event.target.files?.[0])} />
        </div>

        {error && <div className="mx-4 mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">{error}</div>}

        <div className="p-4 pb-28 md:pb-4">
          {activeSection === "setup" && (
            <SettingsGrid>
              <InfoCard title="ขั้นตอนส่งต่อรุ่นน้อง" text="กรอก Supabase bootstrap ใน Vercel ก่อน จากนั้นใช้หน้านี้กรอก LINE, EasySlip, PromptPay, TrueMoney และข้อความ LINE ได้จากเว็บทั้งหมด" />
              <SecretField label="Supabase URL" value={settings.supabaseUrl} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("supabaseUrl", value)} onReset={() => resetField("supabaseUrl")} />
              <SecretField label="Supabase Service Role Key" value={settings.supabaseServiceRoleKey} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("supabaseServiceRoleKey", value)} onReset={() => resetField("supabaseServiceRoleKey")} />
              <SecretField label="LINE Channel Access Token" value={settings.lineChannelAccessToken} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("lineChannelAccessToken", value)} onReset={() => resetField("lineChannelAccessToken")} />
              <SecretField label="LINE Channel Secret" value={settings.lineChannelSecret} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("lineChannelSecret", value)} onReset={() => resetField("lineChannelSecret")} />
              <SecretField label="EasySlip API Key" value={settings.easySlipApiKey} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("easySlipApiKey", value)} onReset={() => resetField("easySlipApiKey")} />
              <TextField label="PromptPay ID" value={settings.promptPayId} onChange={(value) => updateField("promptPayId", value)} onReset={() => resetField("promptPayId")} />
            </SettingsGrid>
          )}

          {activeSection === "app" && (
            <SettingsGrid>
              <TextField label="ชื่อระบบ" value={settings.appName} onChange={(value) => updateField("appName", value)} onReset={() => resetField("appName")} />
              <TextField label="ชื่อห้อง/กลุ่ม" value={settings.classroomName} onChange={(value) => updateField("classroomName", value)} onReset={() => resetField("classroomName")} />
              <TextField label="ชื่อที่แสดงของเหรัญญิก" value={settings.treasurerDisplayName} onChange={(value) => updateField("treasurerDisplayName", value)} onReset={() => resetField("treasurerDisplayName")} />
              <TextField label="ช่องทางติดต่อ" value={settings.contactText} onChange={(value) => updateField("contactText", value)} onReset={() => resetField("contactText")} />
              <TextareaField label="ข้อความท้ายคำแนะนำการชำระเงิน" value={settings.paymentInstructionFooter} onChange={(value) => updateField("paymentInstructionFooter", value)} onReset={() => resetField("paymentInstructionFooter")} rows={4} wide />
            </SettingsGrid>
          )}

          {activeSection === "secrets" && (
            <SettingsGrid>
              <ToggleCard label="แสดงค่า secrets" checked={showSecrets} onChange={setShowSecrets} />
              <SecretField label="Supabase URL" value={settings.supabaseUrl} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("supabaseUrl", value)} onReset={() => resetField("supabaseUrl")} />
              <SecretField label="Supabase Service Role Key" value={settings.supabaseServiceRoleKey} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("supabaseServiceRoleKey", value)} onReset={() => resetField("supabaseServiceRoleKey")} />
              <SecretField label="LINE Channel Access Token" value={settings.lineChannelAccessToken} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("lineChannelAccessToken", value)} onReset={() => resetField("lineChannelAccessToken")} />
              <SecretField label="LINE Channel Secret" value={settings.lineChannelSecret} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("lineChannelSecret", value)} onReset={() => resetField("lineChannelSecret")} />
              <SecretField label="EasySlip API Key" value={settings.easySlipApiKey} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("easySlipApiKey", value)} onReset={() => resetField("easySlipApiKey")} />
              <SecretField label="Vercel Blob Read/Write Token" value={settings.blobReadWriteToken} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("blobReadWriteToken", value)} onReset={() => resetField("blobReadWriteToken")} />
            </SettingsGrid>
          )}

          {activeSection === "payment" && (
            <SettingsGrid>
              <TextField label="PromptPay ID" value={settings.promptPayId} onChange={(value) => updateField("promptPayId", value)} onReset={() => resetField("promptPayId")} />
              <TextField label="ชื่อบัญชีรับโอนธนาคาร" value={settings.bankReceiverName} onChange={(value) => updateField("bankReceiverName", value)} onReset={() => resetField("bankReceiverName")} />
              <TextField label="เลขบัญชีรับโอนธนาคาร" value={settings.bankReceiverAccount} onChange={(value) => updateField("bankReceiverAccount", value)} onReset={() => resetField("bankReceiverAccount")} />
              <TextField label="PromptPay/เลขพร้อมเพย์เพิ่มเติม" value={settings.bankReceiverPromptPay} onChange={(value) => updateField("bankReceiverPromptPay", value)} onReset={() => resetField("bankReceiverPromptPay")} />
              <TextField label="ชื่อบัญชี TrueMoney" value={settings.trueMoneyReceiverName} onChange={(value) => updateField("trueMoneyReceiverName", value)} onReset={() => resetField("trueMoneyReceiverName")} />
              <TextField label="เบอร์ TrueMoney" value={settings.trueMoneyReceiverPhone} onChange={(value) => updateField("trueMoneyReceiverPhone", value)} onReset={() => resetField("trueMoneyReceiverPhone")} />
              <TextareaField label="TrueMoney QR Template Prefix" value={settings.trueMoneyTemplatePrefix} onChange={(value) => updateField("trueMoneyTemplatePrefix", value)} onReset={() => resetField("trueMoneyTemplatePrefix")} rows={4} wide />
              <TextField label="TrueMoney QR Template Suffix" value={settings.trueMoneyTemplateSuffix} onChange={(value) => updateField("trueMoneyTemplateSuffix", value)} onReset={() => resetField("trueMoneyTemplateSuffix")} />
              <TextField label="QR Image URL Template" value={settings.quickChartQrUrlTemplate} onChange={(value) => updateField("quickChartQrUrlTemplate", value)} onReset={() => resetField("quickChartQrUrlTemplate")} />
            </SettingsGrid>
          )}

          {activeSection === "slip" && (
            <SettingsGrid>
              <SecretField label="EasySlip API Key" value={settings.easySlipApiKey} show={showSecrets} onToggle={() => setShowSecrets((value) => !value)} onChange={(value) => updateField("easySlipApiKey", value)} onReset={() => resetField("easySlipApiKey")} />
              <TextField label="Supabase Slip Bucket" value={settings.supabaseSlipBucket} onChange={(value) => updateField("supabaseSlipBucket", value)} onReset={() => resetField("supabaseSlipBucket")} />
              <TextField label="OCR Lang" value={settings.slipOcrLang} onChange={(value) => updateField("slipOcrLang", value)} onReset={() => resetField("slipOcrLang")} />
              <TextField label="OCR Max Variants" value={settings.slipOcrMaxVariants} onChange={(value) => updateField("slipOcrMaxVariants", value)} onReset={() => resetField("slipOcrMaxVariants")} />
              <ToggleCard label="EasySlip check duplicate" checked={settings.easySlipCheckDuplicate} onChange={(value) => updateField("easySlipCheckDuplicate", value)} />
              <ToggleCard label="EasySlip match account" checked={settings.easySlipMatchAccount} onChange={(value) => updateField("easySlipMatchAccount", value)} />
              <ToggleCard label="Always run local OCR" checked={settings.easySlipAlwaysRunLocalOcr} onChange={(value) => updateField("easySlipAlwaysRunLocalOcr", value)} />
              <ToggleCard label="Auto reject invalid image" checked={settings.slipAutoRejectInvalidImage} onChange={(value) => updateField("slipAutoRejectInvalidImage", value)} />
              <ToggleCard label="TrueMoney auto reject receiver mismatch" checked={settings.trueMoneyAutoRejectReceiverMismatch} onChange={(value) => updateField("trueMoneyAutoRejectReceiverMismatch", value)} />
            </SettingsGrid>
          )}

          {activeSection === "richMenu" && (
            <SettingsGrid>
              <TextField label="Register Rich Menu Name" value={settings.lineRegisterRichMenuName} onChange={(value) => updateField("lineRegisterRichMenuName", value)} onReset={() => resetField("lineRegisterRichMenuName")} />
              <TextField label="Student Rich Menu Name" value={settings.lineRegisteredRichMenuName} onChange={(value) => updateField("lineRegisteredRichMenuName", value)} onReset={() => resetField("lineRegisteredRichMenuName")} />
              <TextField label="Chat Bar Text" value={settings.lineRichMenuChatBarText} onChange={(value) => updateField("lineRichMenuChatBarText", value)} onReset={() => resetField("lineRichMenuChatBarText")} />
              <ActionEditor label="Register action" value={settings.lineRegisterAction} onChange={(part, value) => updateAction("lineRegisterAction", part, value)} />
              <ActionEditor label="Pay action" value={settings.linePayAction} onChange={(part, value) => updateAction("linePayAction", part, value)} />
              <ActionEditor label="Status action" value={settings.lineStatusAction} onChange={(part, value) => updateAction("lineStatusAction", part, value)} />
              <ActionEditor label="History action" value={settings.lineHistoryAction} onChange={(part, value) => updateAction("lineHistoryAction", part, value)} />
              <ActionEditor label="Total action" value={settings.lineTotalAction} onChange={(part, value) => updateAction("lineTotalAction", part, value)} />
            </SettingsGrid>
          )}

          {activeSection === "line" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-3xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/60">
                <Search className="h-4 w-4 text-zinc-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาข้อความ LINE" className="min-w-0 flex-1 border-0 bg-transparent p-1 text-sm shadow-none focus:ring-0" />
              </div>
              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
                ใช้ตัวแปรได้ เช่น <code className="rounded bg-white px-1 dark:bg-zinc-800">{"{{studentName}}"}</code>, <code className="rounded bg-white px-1 dark:bg-zinc-800">{"{{studentNumber}}"}</code>, <code className="rounded bg-white px-1 dark:bg-zinc-800">{"{{reason}}"}</code>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredLineFields.map((field) => (
                  <div key={field.key} className="apple-panel p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-zinc-900 dark:text-zinc-100">{field.label}</label>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{field.hint}</p>
                      </div>
                      <button type="button" onClick={() => resetLineMessage(field.key)} className="apple-ghost-button shrink-0 rounded-xl px-2.5 py-1 text-xs font-semibold">ค่าเดิม</button>
                    </div>
                    <textarea value={settings.lineMessages[field.key] || ""} onChange={(event) => updateLineMessage(field.key, event.target.value)} rows={5} className="w-full resize-y rounded-2xl border bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:bg-zinc-950" style={{ borderColor: "var(--line)" }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 z-10 border-t bg-white/80 p-3 backdrop-blur md:hidden dark:bg-zinc-950/80" style={{ borderColor: "var(--line)" }}>
          <button type="button" onClick={saveSettings} disabled={isSaving} className="apple-button w-full rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-60">
            {isSaving ? "กำลังบันทึก..." : "บันทึกตั้งค่า"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}

function SettingsNavItem({ active, icon, label, description, onClick }: { active: boolean; icon: ReactNode; label: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`pressable flex w-full items-start gap-3 rounded-3xl p-3 text-left transition ${active ? "nav-item-active" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        <span className="mt-0.5 hidden text-xs opacity-70 sm:block">{description}</span>
      </span>
    </button>
  );
}

function TextField({ label, value, onChange, onReset }: { label: string; value: string; onChange: (value: string) => void; onReset?: () => void }) {
  return (
    <label className="block">
      <FieldHeader label={label} onReset={onReset} />
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border bg-white px-3 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:bg-zinc-950" style={{ borderColor: "var(--line)" }} />
    </label>
  );
}

function SecretField({ label, value, show, onToggle, onChange, onReset }: { label: string; value: string; show: boolean; onToggle: () => void; onChange: (value: string) => void; onReset?: () => void }) {
  return (
    <label className="block">
      <FieldHeader label={label} onReset={onReset} />
      <div className="flex overflow-hidden rounded-2xl border bg-white dark:bg-zinc-950" style={{ borderColor: "var(--line)" }}>
        <input type={show ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 border-0 px-3 py-3 text-sm shadow-none focus:ring-0" />
        <button type="button" onClick={onToggle} className="px-3 text-zinc-500">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
      </div>
    </label>
  );
}

function TextareaField({ label, value, onChange, onReset, rows, wide = false }: { label: string; value: string; onChange: (value: string) => void; onReset?: () => void; rows: number; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <FieldHeader label={label} onReset={onReset} />
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className="w-full resize-y rounded-2xl border bg-white px-3 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:bg-zinc-950" style={{ borderColor: "var(--line)" }} />
    </label>
  );
}

function FieldHeader({ label, onReset }: { label: string; onReset?: () => void }) {
  return (
    <span className="mb-1.5 flex items-center justify-between gap-3">
      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{label}</span>
      {onReset && <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><RotateCcw className="h-3 w-3" /> ค่าเดิม</button>}
    </span>
  );
}

function ToggleCard({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`pressable flex items-center justify-between rounded-3xl border p-4 text-left ${checked ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}>
      <span className="text-sm font-semibold">{label}</span>
      <span className={`h-6 w-11 rounded-full p-0.5 transition ${checked ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
        <span className={`block h-5 w-5 rounded-full bg-white transition ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function ActionEditor({ label, value, onChange }: { label: string; value: RichMenuActionSettings; onChange: (part: keyof RichMenuActionSettings, value: string) => void }) {
  return (
    <div className="apple-panel p-4">
      <div className="mb-3 text-sm font-bold">{label}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="ป้ายปุ่ม" value={value.label} onChange={(nextValue) => onChange("label", nextValue)} />
        <TextField label="ข้อความที่ส่ง" value={value.text} onChange={(nextValue) => onChange("text", nextValue)} />
      </div>
    </div>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4 text-blue-900 md:col-span-2 dark:border-blue-500/30 dark:bg-blue-950/30 dark:text-blue-100">
      <div className="font-bold">{title}</div>
      <div className="mt-1 text-sm opacity-80">{text}</div>
    </div>
  );
}

function sectionTitle(section: SettingsSection) {
  if (section === "setup") return "Setup Wizard";
  if (section === "secrets") return "Secrets และ API keys";
  if (section === "payment") return "ข้อมูลรับเงินและ QR";
  if (section === "slip") return "Slip checker";
  if (section === "richMenu") return "LINE Rich Menu";
  if (section === "line") return "ข้อความ LINE";
  return "ข้อมูลระบบ";
}

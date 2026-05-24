export type LineMessageKey =
  | "alreadyRegistered"
  | "registrationIntro"
  | "registrationNotFound"
  | "registrationStudentTaken"
  | "registrationSuccess"
  | "mustRegister"
  | "paymentNotFound"
  | "paymentWrongLineUser"
  | "invalidPaymentMethod"
  | "cashPaymentReceived"
  | "qrPaymentInstruction"
  | "noActiveSlipRequest"
  | "slipAutoApproved"
  | "slipAutoRejected"
  | "slipDuplicateSuspected"
  | "slipPendingReview"
  | "paymentCancelEmpty"
  | "paymentCancelSuccess"
  | "lineApproved"
  | "lineRejected"
  | "scheduleAnnouncementFooter"
  | "scheduleReminderFooter";

export type RichMenuActionSettings = {
  label: string;
  text: string;
};

export type AppPublicSettings = {
  appName: string;
  classroomName: string;
  treasurerDisplayName: string;
  contactText: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  lineRegisterRichMenuName: string;
  lineRegisteredRichMenuName: string;
  lineRichMenuChatBarText: string;
  lineRegisterAction: RichMenuActionSettings;
  linePayAction: RichMenuActionSettings;
  lineStatusAction: RichMenuActionSettings;
  lineHistoryAction: RichMenuActionSettings;
  lineTotalAction: RichMenuActionSettings;
  promptPayId: string;
  bankReceiverName: string;
  bankReceiverAccount: string;
  bankReceiverPromptPay: string;
  trueMoneyReceiverName: string;
  trueMoneyReceiverPhone: string;
  trueMoneyTemplatePrefix: string;
  trueMoneyTemplateSuffix: string;
  quickChartQrUrlTemplate: string;
  easySlipApiKey: string;
  easySlipCheckDuplicate: boolean;
  easySlipMatchAccount: boolean;
  easySlipAlwaysRunLocalOcr: boolean;
  slipAutoRejectInvalidImage: boolean;
  trueMoneyAutoRejectReceiverMismatch: boolean;
  slipOcrLang: string;
  slipOcrMaxVariants: string;
  supabaseSlipBucket: string;
  blobReadWriteToken: string;
  paymentInstructionFooter: string;
  lineMessages: Record<LineMessageKey, string>;
};

export const DEFAULT_LINE_MESSAGES: Record<LineMessageKey, string> = {
  alreadyRegistered: [
    "บัญชี LINE นี้ลงทะเบียนไว้แล้วครับ ✅",
    "ชื่อ: {{studentName}}",
    "เลขที่: {{studentNumber}}",
    "กดเมนู ชำระเงิน ใช้งานต่อได้เลยครับ 💸",
  ].join("\n"),
  registrationIntro: [
    "มาลงทะเบียน LINE กับระบบการเงินห้องเรียนกันครับ ✨",
    "พิมพ์เลขที่ของตัวเอง เช่น 24",
    "หรือพิมพ์ว่า ลงทะเบียน 24",
    "พอลงทะเบียนเสร็จ จะกดเมนู ชำระเงิน ต่อได้ทันทีครับ 🚀",
  ].join("\n"),
  registrationNotFound: [
    "ไม่พบนักเรียนเลขที่ {{studentNumber}} ครับ 🧐",
    "ตรวจเลขที่อีกครั้ง หรือแจ้งเหรัญญิกให้เพิ่มข้อมูลนักเรียนก่อนนะครับ",
  ].join("\n"),
  registrationStudentTaken: [
    "เลขที่ {{studentNumber}} มีบัญชี LINE ลงทะเบียนไว้แล้วครับ 👀",
    "ถ้าต้องการเปลี่ยนไปใช้บัญชี LINE นี้แทน",
    "ให้เหรัญญิกลบ LINE User ID เดิมของนักเรียนคนนี้ในระบบก่อนนะครับ 🔐",
  ].join("\n"),
  registrationSuccess: [
    "ลงทะเบียนสำเร็จแล้วครับ 🎉",
    "ชื่อ: {{studentName}}",
    "เลขที่: {{studentNumber}}",
    "{{menuStatus}}",
    "ต่อไปแจ้งเตือนเรื่องชำระเงินจะส่งมาที่บัญชีนี้นะครับ 🔔",
  ].join("\n"),
  mustRegister: [
    "ต้องลงทะเบียนก่อนใช้งานครับ 👀",
    "พิมพ์เลขที่ของตัวเอง เช่น 24",
    "หรือพิมพ์ว่า ลงทะเบียน 24",
  ].join("\n"),
  paymentNotFound: [
    "ไม่พบรายการชำระเงินครับ 😅",
    "รายการอาจหมดอายุหรือถูกแทนที่แล้ว",
    "เริ่มใหม่ได้โดยพิมพ์ ชำระเงิน",
  ].join("\n"),
  paymentWrongLineUser: [
    "รายการนี้ไม่ตรงกับบัญชี LINE ของคุณครับ 🔐",
    "ระบบเลยไปต่อให้ไม่ได้ เพื่อความปลอดภัยนะครับ",
  ].join("\n"),
  invalidPaymentMethod: [
    "วิธีชำระเงินนี้ยังไม่ถูกต้องครับ 🧐",
    "ลองเลือกจากปุ่มที่ระบบแสดงให้อีกครั้งนะครับ",
  ].join("\n"),
  cashPaymentReceived: "ระบบจะบันทึกยอดให้หลังจากเหรัญญิกยืนยันในระบบนะครับ 💵",
  qrPaymentInstruction: [
    "จ่ายเสร็จแล้ว ส่งรูปสลิปกลับมาในแชทนี้ได้เลยครับ 📸",
    "บอทรอสลิปอยู่น้า",
  ].join("\n"),
  noActiveSlipRequest: [
    "ยังไม่มีรายการที่กำลังรอชำระนะครับ 😅",
    "กรุณากดเมนู ‘ชำระเงิน’ แล้วเลือกรายการที่ต้องการจ่ายก่อนส่งสลิปน้า",
  ].join("\n"),
  slipAutoApproved: [
    "สลิปผ่านแล้วครับ ✅",
    "ระบบตรวจสอบสลิปอัตโนมัติเรียบร้อย",
    "ชำระเงินเรียบร้อย ขอบคุณมากครับ 🙌",
  ].join("\n"),
  slipAutoRejected: [
    "สลิปยังไม่ผ่านการตรวจสอบนะครับ",
    "{{reason}}",
    "กรุณาส่งสลิปใหม่ที่ยอดเงินและบัญชีปลายทางถูกต้องอีกครั้ง",
  ].join("\n"),
  slipDuplicateSuspected: [
    "สลิปนี้เหมือนเคยถูกส่งมาแล้วนะครับ 🧐",
    "ระบบบันทึกไว้ให้เหรัญญิกตรวจสอบอีกครั้ง",
    "ถ้าเป็นสลิปใหม่จริง ๆ ไม่ต้องกังวลครับ",
  ].join("\n"),
  slipPendingReview: [
    "ได้รับสลิปแล้วครับ ✅",
    "ระบบบันทึกสลิปเรียบร้อย",
    "",
    "สถานะตอนนี้: รอเหรัญญิกตรวจสอบ 🧾",
    "ถ้าตรวจผ่าน ระบบจะแจ้งยืนยันให้อีกครั้งนะครับ",
  ].join("\n"),
  paymentCancelEmpty: "ตอนนี้ไม่มีรายการชำระเงินที่กำลังดำเนินการอยู่ครับ 👀",
  paymentCancelSuccess: "ยกเลิกรายการชำระเงินให้เรียบร้อยแล้วครับ ✅",
  lineApproved: [
    "สลิปผ่านแล้วครับ ✅",
    "ชำระเงินเรียบร้อย ขอบคุณมากครับ 🙌",
  ].join("\n"),
  lineRejected: [
    "สลิปยังไม่ผ่านการตรวจสอบนะครับ 😅",
    "เหตุผล: {{reason}}",
    "กรุณาส่งสลิปใหม่อีกครั้งได้เลย",
  ].join("\n"),
  scheduleAnnouncementFooter: "กดเมนู ชำระเงิน เมื่อต้องการดูรายการและเลือกช่องทางจ่ายได้เลยครับ 💸",
  scheduleReminderFooter: "อย่าลืมชำระเงินตามกำหนดนะครับ ขอบคุณครับ/ค่ะ 🙏",
};

export const DEFAULT_PUBLIC_SETTINGS: AppPublicSettings = {
  appName: "ระบบการเงินห้องเรียน",
  classroomName: "ห้องเรียน",
  treasurerDisplayName: "เหรัญญิก",
  contactText: "",
  supabaseUrl: "",
  supabaseServiceRoleKey: "",
  lineChannelAccessToken: "",
  lineChannelSecret: "",
  lineRegisterRichMenuName: "Classroom Finance Register Menu",
  lineRegisteredRichMenuName: "Classroom Finance Student Menu",
  lineRichMenuChatBarText: "เมนูการเงิน",
  lineRegisterAction: { label: "ลงทะเบียน", text: "ลงทะเบียน" },
  linePayAction: { label: "ชำระเงิน", text: "ชำระเงิน" },
  lineStatusAction: { label: "สถานะ", text: "เมนูสถานะ" },
  lineHistoryAction: { label: "ประวัติ", text: "เมนูประวัติ" },
  lineTotalAction: { label: "ยอดรวม", text: "เมนูยอดรวม" },
  promptPayId: "004666006046829",
  bankReceiverName: "",
  bankReceiverAccount: "",
  bankReceiverPromptPay: "",
  trueMoneyReceiverName: "",
  trueMoneyReceiverPhone: "",
  trueMoneyTemplatePrefix: "00020101021229390016A000000677010111031514000098913543353037645",
  trueMoneyTemplateSuffix: "5802TH6304",
  quickChartQrUrlTemplate: "https://quickchart.io/qr?size=600&margin=2&text={{payload}}",
  easySlipApiKey: "",
  easySlipCheckDuplicate: true,
  easySlipMatchAccount: true,
  easySlipAlwaysRunLocalOcr: false,
  slipAutoRejectInvalidImage: true,
  trueMoneyAutoRejectReceiverMismatch: false,
  slipOcrLang: "eng+tha",
  slipOcrMaxVariants: "10",
  supabaseSlipBucket: "payment-slips",
  blobReadWriteToken: "",
  paymentInstructionFooter: "หากข้อมูลไม่ถูกต้อง กรุณาติดต่อเหรัญญิก",
  lineMessages: DEFAULT_LINE_MESSAGES,
};

const LINE_MESSAGE_KEYS = Object.keys(DEFAULT_LINE_MESSAGES) as LineMessageKey[];

export function sanitizePublicSettings(input: unknown): AppPublicSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawLineMessages = source.lineMessages && typeof source.lineMessages === "object"
    ? source.lineMessages as Record<string, unknown>
    : {};

  return {
    appName: textValue(source.appName, DEFAULT_PUBLIC_SETTINGS.appName, 120),
    classroomName: textValue(source.classroomName, DEFAULT_PUBLIC_SETTINGS.classroomName, 120),
    treasurerDisplayName: textValue(source.treasurerDisplayName, DEFAULT_PUBLIC_SETTINGS.treasurerDisplayName, 120),
    contactText: textValue(source.contactText, "", 500),
    supabaseUrl: textValue(source.supabaseUrl, "", 500),
    supabaseServiceRoleKey: textValue(source.supabaseServiceRoleKey, "", 4000),
    lineChannelAccessToken: textValue(source.lineChannelAccessToken, "", 4000),
    lineChannelSecret: textValue(source.lineChannelSecret, "", 4000),
    lineRegisterRichMenuName: textValue(source.lineRegisterRichMenuName, DEFAULT_PUBLIC_SETTINGS.lineRegisterRichMenuName, 200),
    lineRegisteredRichMenuName: textValue(source.lineRegisteredRichMenuName, DEFAULT_PUBLIC_SETTINGS.lineRegisteredRichMenuName, 200),
    lineRichMenuChatBarText: textValue(source.lineRichMenuChatBarText, DEFAULT_PUBLIC_SETTINGS.lineRichMenuChatBarText, 80),
    lineRegisterAction: actionValue(source.lineRegisterAction, DEFAULT_PUBLIC_SETTINGS.lineRegisterAction),
    linePayAction: actionValue(source.linePayAction, DEFAULT_PUBLIC_SETTINGS.linePayAction),
    lineStatusAction: actionValue(source.lineStatusAction, DEFAULT_PUBLIC_SETTINGS.lineStatusAction),
    lineHistoryAction: actionValue(source.lineHistoryAction, DEFAULT_PUBLIC_SETTINGS.lineHistoryAction),
    lineTotalAction: actionValue(source.lineTotalAction, DEFAULT_PUBLIC_SETTINGS.lineTotalAction),
    promptPayId: textValue(source.promptPayId, DEFAULT_PUBLIC_SETTINGS.promptPayId, 120),
    bankReceiverName: textValue(source.bankReceiverName, "", 200),
    bankReceiverAccount: textValue(source.bankReceiverAccount, "", 120),
    bankReceiverPromptPay: textValue(source.bankReceiverPromptPay, "", 120),
    trueMoneyReceiverName: textValue(source.trueMoneyReceiverName, "", 200),
    trueMoneyReceiverPhone: textValue(source.trueMoneyReceiverPhone, "", 120),
    trueMoneyTemplatePrefix: textValue(source.trueMoneyTemplatePrefix, DEFAULT_PUBLIC_SETTINGS.trueMoneyTemplatePrefix, 1000),
    trueMoneyTemplateSuffix: textValue(source.trueMoneyTemplateSuffix, DEFAULT_PUBLIC_SETTINGS.trueMoneyTemplateSuffix, 120),
    quickChartQrUrlTemplate: textValue(source.quickChartQrUrlTemplate, DEFAULT_PUBLIC_SETTINGS.quickChartQrUrlTemplate, 500),
    easySlipApiKey: textValue(source.easySlipApiKey, "", 4000),
    easySlipCheckDuplicate: booleanValue(source.easySlipCheckDuplicate, DEFAULT_PUBLIC_SETTINGS.easySlipCheckDuplicate),
    easySlipMatchAccount: booleanValue(source.easySlipMatchAccount, DEFAULT_PUBLIC_SETTINGS.easySlipMatchAccount),
    easySlipAlwaysRunLocalOcr: booleanValue(source.easySlipAlwaysRunLocalOcr, DEFAULT_PUBLIC_SETTINGS.easySlipAlwaysRunLocalOcr),
    slipAutoRejectInvalidImage: booleanValue(source.slipAutoRejectInvalidImage, DEFAULT_PUBLIC_SETTINGS.slipAutoRejectInvalidImage),
    trueMoneyAutoRejectReceiverMismatch: booleanValue(source.trueMoneyAutoRejectReceiverMismatch, DEFAULT_PUBLIC_SETTINGS.trueMoneyAutoRejectReceiverMismatch),
    slipOcrLang: textValue(source.slipOcrLang, DEFAULT_PUBLIC_SETTINGS.slipOcrLang, 40),
    slipOcrMaxVariants: textValue(source.slipOcrMaxVariants, DEFAULT_PUBLIC_SETTINGS.slipOcrMaxVariants, 10),
    supabaseSlipBucket: textValue(source.supabaseSlipBucket, DEFAULT_PUBLIC_SETTINGS.supabaseSlipBucket, 120),
    blobReadWriteToken: textValue(source.blobReadWriteToken, "", 4000),
    paymentInstructionFooter: textValue(source.paymentInstructionFooter, DEFAULT_PUBLIC_SETTINGS.paymentInstructionFooter, 500),
    lineMessages: Object.fromEntries(
      LINE_MESSAGE_KEYS.map((key) => [
        key,
        textValue(rawLineMessages[key], DEFAULT_LINE_MESSAGES[key], 1600),
      ])
    ) as Record<LineMessageKey, string>,
  };
}

export function mergePublicSettings(input: unknown): AppPublicSettings {
  const sanitized = sanitizePublicSettings(input);
  return {
    ...DEFAULT_PUBLIC_SETTINGS,
    ...sanitized,
    lineMessages: {
      ...DEFAULT_LINE_MESSAGES,
      ...sanitized.lineMessages,
    },
  };
}

function textValue(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function actionValue(value: unknown, fallback: RichMenuActionSettings): RichMenuActionSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    label: textValue(source.label, fallback.label, 40),
    text: textValue(source.text, fallback.text, 120),
  };
}

import { createHmac, timingSafeEqual } from "crypto";
import generatePayload from "promptpay-qr";
import { badRequest, ok, serverError } from "@/lib/api/response";
import { createRecord, deleteRecord, listRecords, updateRecord, type Row } from "@/lib/supabase/server";
import { mapLinePaymentRequest, mapSchedule, mapStudent, mapTransaction } from "@/lib/supabase/mappers";
import { analyzeSlipImage } from "@/lib/server/slipCheck";
import { deleteSlipImages, storeSlipImage } from "@/lib/server/slipStorage";
import { linkLineRichMenuByName } from "@/lib/server/line";
import { approveLinePaymentRequest } from "@/lib/server/linePaymentReview";
import { getRuntimeSettings, lineMessage } from "@/lib/server/appSettings";
import { DEFAULT_PUBLIC_SETTINGS, type AppPublicSettings } from "@/lib/settings/schema";

const DEFAULT_SETTINGS = DEFAULT_PUBLIC_SETTINGS;

function crc16CcittFalse(data: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function generateTrueMoneyPayload(amount: number, settings: AppPublicSettings): string {
  const amountStr = amount.toFixed(2);
  const amountLength = amountStr.length.toString().padStart(2, "0");
  const dataWithoutCrc = `${settings.trueMoneyTemplatePrefix}4${amountLength}${amountStr}${settings.trueMoneyTemplateSuffix}`;
  const crc = crc16CcittFalse(dataWithoutCrc);
  return `${dataWithoutCrc}${crc}`;
}

type LineWebhookBody = {
  events?: LineWebhookEvent[];
};

type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  postback?: {
    data?: string;
  };
  source?: {
    type?: string;
    userId?: string;
  };
  message?: {
    type?: string;
    text?: string;
    id?: string;
  };
};

type LineMessage = Record<string, unknown>;
type LineFlexBox = Record<string, unknown>;

const studentColumns = ["line_user_id"];

export async function GET() {
  return ok({
    status: "ok",
    service: "line-webhook",
    usage: "Set this endpoint as your LINE Messaging API webhook URL.",
  });
}

export async function POST(request: Request) {
  try {
    const channelSecret = (await getRuntimeSettings()).lineChannelSecret;
    if (!channelSecret) return badRequest("Missing LINE_CHANNEL_SECRET");

    const bodyText = await request.text();
    const signature = request.headers.get("x-line-signature") || "";
    if (!isValidLineSignature(bodyText, signature, channelSecret)) {
      return badRequest("Invalid LINE signature");
    }

    const body = JSON.parse(bodyText) as LineWebhookBody;
    const events = Array.isArray(body.events) ? body.events : [];
    await Promise.all(events.map(handleLineEvent));

    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}

async function handleLineEvent(event: LineWebhookEvent) {
  if (event.source?.type !== "user" || !event.source.userId) return;

  if (event.type === "postback") {
    await handleAction(event, event.postback?.data || "");
    return;
  }

  if (event.type !== "message") return;

  if (event.message?.type === "image" && event.message.id) {
    await handleSlipImage(event, event.message.id);
    return;
  }

  if (event.message?.type !== "text") return;

  const text = event.message.text?.trim() || "";
  const settings = await getRuntimeSettings();
  if (isPayCommand(text, settings)) {
    await showPayMenu(event);
    return;
  }
  if (isCancelCommand(text)) {
    await cancelActivePayment(event);
    return;
  }
  if (isStatusCommand(text, settings)) {
    await showStudentStatus(event);
    return;
  }
  if (isHistoryCommand(text, settings)) {
    await showStudentHistory(event);
    return;
  }
  if (isTotalCommand(text, settings)) {
    await showClassroomTotal(event);
    return;
  }

  // Handle typed amount for active payment request (before registration check)
  if (/^\d+(?:\.\d{1,2})?$/.test(text) && event.source?.userId) {
    const activeRequest = (await listRecords<Row>("line_payment_requests"))
      .map(mapLinePaymentRequest)
      .filter((r) => r.line_user_id === event.source?.userId && r.status === "selecting")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (activeRequest) {
      await handleAmountSelection(event, activeRequest.id, parseFloat(text));
      return;
    }
  }

  if (isCoreTextCommand(text, settings) || isRegistrationText(text, settings) || text.startsWith("pay:")) {
    await handleAction(event, text);
  }
}

async function handleAction(event: LineWebhookEvent, action: string) {
  if (!event.source?.userId) return;
  const normalized = action.trim();
  const number = parseRegistrationNumber(normalized);
  const settings = await getRuntimeSettings();

  if (!number) {
    if (isRegistrationHelpCommand(normalized, settings)) {
      const registeredStudent = await getStudentByLineUserId(event.source.userId);
      if (registeredStudent) {
        const menuLink = await linkLineRichMenuByName(event.source.userId, settings.lineRegisteredRichMenuName);
        await replyLineText(event.replyToken, await lineMessage("alreadyRegistered", {
          studentName: studentDisplayName(registeredStudent),
          studentNumber: registeredStudent.number,
          menuStatus: menuLink.ok ? "เมนูพร้อมใช้งานแล้วครับ" : "ยังเปลี่ยนเมนูไม่ได้ กรุณาให้เหรัญญิกรันตั้งค่า Rich Menu อีกครั้งนะครับ",
        }));
        return;
      }

      await linkLineRichMenuByName(event.source.userId, settings.lineRegisterRichMenuName);
      await replyLineText(event.replyToken, await lineMessage("registrationIntro"));
      return;
    }
    if (normalized.startsWith("pay:schedule:")) {
      await handleScheduleSelection(event, normalized.replace("pay:schedule:", ""));
      return;
    }
    if (normalized.startsWith("pay:amount:")) {
      const parts = normalized.split(":");
      await handleAmountSelection(event, parts[2], parseFloat(parts[3]));
      return;
    }
    if (normalized.startsWith("pay:method:")) {
      const [, , requestId, method] = normalized.split(":");
      await handleMethodSelection(event, requestId, method);
      return;
    }

    return;
  }

  const studentRows = await listRecords<Row>("students");
  const students = studentRows.map(mapStudent);
  const registeredStudent = students.find((item) => item.line_user_id === event.source?.userId);
  if (registeredStudent) {
    const menuLink = await linkLineRichMenuByName(event.source.userId, settings.lineRegisteredRichMenuName);
    await replyLineText(event.replyToken, await lineMessage("alreadyRegistered", {
      studentName: studentDisplayName(registeredStudent),
      studentNumber: registeredStudent.number,
      menuStatus: menuLink.ok ? "กดเมนู ชำระเงิน ใช้งานต่อได้เลยครับ 💸" : "ยังเปลี่ยนเมนูไม่ได้ กรุณาให้เหรัญญิกรันตั้งค่า Rich Menu อีกครั้งนะครับ",
    }));
    return;
  }

  const student = students.find((item) => item.number === number);

  if (!student) {
    await replyLineText(event.replyToken, await lineMessage("registrationNotFound", { studentNumber: number }));
    return;
  }

  if (student.line_user_id && student.line_user_id !== event.source.userId) {
    await replyLineText(event.replyToken, await lineMessage("registrationStudentTaken", { studentNumber: student.number }));
    return;
  }

  await updateRecord<Row>("students", student.id, { line_user_id: event.source.userId }, studentColumns);
  const menuLink = await linkLineRichMenuByName(event.source.userId, settings.lineRegisteredRichMenuName);

  await replyLineText(event.replyToken, await lineMessage("registrationSuccess", {
    studentName: studentDisplayName(student),
    studentNumber: student.number,
    menuStatus: menuLink.ok
      ? "เปลี่ยนเมนูเป็น ชำระเงิน / สถานะ / ประวัติ / ยอดรวม ให้เรียบร้อยแล้วครับ"
      : "รบกวนให้เหรัญญิกช่วยรันตั้งค่า Rich Menu อีกครั้งนะครับ",
  }));
}

async function showPayMenu(event: LineWebhookEvent) {
  const student = await getStudentByLineUserId(event.source?.userId);
  if (!student) {
    await replyRegisterPrompt(event);
    return;
  }

  const debts = await getUnpaidSchedulesForStudent(student.id);
  if (debts.length === 0) {
    await replyLineMessages(event.replyToken, [
      createFlexMessage("ตอนนี้ไม่มีรายการค้างชำระ", createPayMenuBubble(student, debts)),
    ]);
    return;
  }

  const message = createFlexMessage(
    `มีรายการค้างชำระ ${debts.length} รายการ`,
    createPayMenuBubble(student, debts)
  );

  await replyLineMessages(event.replyToken, [
    message,
  ]);
}

async function handleScheduleSelection(event: LineWebhookEvent, scheduleId: string) {
  const student = await getStudentByLineUserId(event.source?.userId);
  if (!student) {
    await replyLineText(event.replyToken, [
      "ต้องลงทะเบียนก่อนใช้งานครับ 👀",
      "ระบบจะได้รู้ว่าใครกำลังจะจ่าย",
      "",
      "ตัวอย่าง: ลงทะเบียน 24",
    ].join("\n"));
    return;
  }

  const debt = (await getUnpaidSchedulesForStudent(student.id)).find((item) => item.schedule.id === scheduleId);
  if (!debt) {
    await replyLineText(event.replyToken, [
      "รายการนี้ชำระครบแล้ว หรือไม่อยู่ในรายการของคุณครับ 🧐",
      "",
      "ลองกดเมนู ชำระเงิน เพื่อดูรายการล่าสุดอีกครั้งนะครับ",
    ].join("\n"));
    return;
  }

  const existingRequests = (await listRecords<Row>("line_payment_requests"))
    .map(mapLinePaymentRequest)
    .filter((request) =>
      request.line_user_id === event.source?.userId &&
      request.student_id === student.id &&
      request.schedule_id === scheduleId &&
      ["selecting", "awaiting_slip", "pending_slip_review", "pending_review"].includes(request.status)
    );

  await Promise.all(existingRequests.map((request) =>
    updateRecord<Row>("line_payment_requests", request.id, { status: "expired", note: "Replaced by newer LINE payment request" }, ["status", "note"])
  ));

  const request = await createRecord<Row>("line_payment_requests", {
    line_user_id: event.source?.userId,
    student_id: student.id,
    schedule_id: debt.schedule.id,
    amount: debt.remaining,
    status: "selecting",
  });

  const message = createFlexMessage(
    `เลือกจำนวนเงิน ${debt.schedule.name}`,
    createAmountSelectionBubble(String(request.id), debt.schedule.name, debt.remaining)
  );

  await replyLineMessages(event.replyToken, [message]);
}

async function handleAmountSelection(event: LineWebhookEvent, requestId: string, amount: number) {
  const requests = await listRecords<Row>("line_payment_requests");
  const row = requests.find((r) => r.id === requestId);
  if (!row) {
    await replyLineText(event.replyToken, await lineMessage("paymentNotFound"));
    return;
  }

  const request = mapLinePaymentRequest(row);
  if (request.line_user_id !== event.source?.userId) {
    await replyLineText(event.replyToken, await lineMessage("paymentWrongLineUser"));
    return;
  }
  if (request.status !== "selecting") {
    await replyLineText(event.replyToken, [
      "รายการนี้เลือกจำนวนเงินไปแล้วครับ",
      "เริ่มใหม่ได้โดยพิมพ์ ชำระเงิน",
    ].join("\n"));
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    await replyLineText(event.replyToken, "กรุณาระบุจำนวนเงินที่ถูกต้อง (มากกว่า 0) ครับ");
    return;
  }
  if (amount > request.amount) {
    await replyLineText(event.replyToken, [
      `จำนวนเงินเกินยอดค้าง ${formatBaht(request.amount)} ครับ 🧐`,
      "ลองพิมพ์จำนวนใหม่ หรือกดปุ่มจ่ายเต็มจำนวน",
    ].join("\n"));
    return;
  }

  const roundedAmount = Math.round(amount * 100) / 100;
  await updateRecord<Row>("line_payment_requests", request.id, { amount: roundedAmount }, ["amount"]);

  // Look up schedule name
  const schedules = (await listRecords<Row>("schedules")).map(mapSchedule);
  const schedule = schedules.find((s) => s.id === request.schedule_id);
  const scheduleName = schedule?.name || "ชำระเงิน";

  const message = createFlexMessage(
    `เลือกวิธีชำระเงิน ${scheduleName}`,
    createPaymentMethodBubble(request.id, scheduleName, roundedAmount)
  );

  await replyLineMessages(event.replyToken, [message]);
}

function createPayMenuBubble(
  student: ReturnType<typeof mapStudent>,
  debts: Awaited<ReturnType<typeof getUnpaidSchedulesForStudent>>
) {
  const totalDebt = debts.reduce((sum, debt) => sum + debt.remaining, 0);
  const bodyContents: LineFlexBox[] = [
    flexHeader("ชำระเงิน", `${student.prefix} ${student.first_name} ${student.last_name}`),
    flexText(`เลขที่ ${student.number}${student.nick_name ? ` (${student.nick_name})` : ""}`, "#6B7280", "sm"),
    flexSeparator(),
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        metricBox("ยอดค้างรวม", formatBaht(totalDebt), "#DC2626", "#FEF2F2"),
        metricBox("รายการค้าง", `${debts.length} รายการ`, "#2563EB", "#EFF6FF"),
      ],
    },
  ];

  if (debts.length === 0) {
    bodyContents.push(emptyStateBox("ตอนนี้ไม่มีรายการค้างชำระครับ ✅", "กระเป๋าสตางค์รอดแล้ววันนี้"));
  } else {
    bodyContents.push(flexSectionTitle("แตะเลือกรายการที่ต้องการจ่าย"));
    bodyContents.push(...debts.slice(0, 8).map((debt) =>
      paymentDebtButton(
        debt.schedule.name,
        debt.remaining,
        debt.schedule.end_date || debt.schedule.start_date,
        `pay:schedule:${debt.schedule.id}`
      )
    ));
    if (debts.length > 8) {
      bodyContents.push(flexText(`และอีก ${debts.length - 8} รายการ`, "#6B7280", "xs"));
    }
    bodyContents.push(flexButton("ยกเลิก", { type: "message", label: "ยกเลิก", text: "ยกเลิก" }, "secondary", "#6B7280"));
  }

  return flexBubble(bodyContents);
}

function createAmountSelectionBubble(requestId: string, scheduleName: string, remaining: number) {
  const half = Math.round(remaining / 2 * 100) / 100;
  const bodyContents: LineFlexBox[] = [
    flexHeader("เลือกจำนวนเงิน", scheduleName),
    flexSeparator(),
    metricBox("ยอดค้างทั้งหมด", formatBaht(remaining), "#2563EB", "#EFF6FF", "xxl"),
    flexText("แตะปุ่มจำนวนเงินที่ต้องการจ่าย หรือพิมพ์จำนวนเงินเอง", "#374151", "sm"),
    flexText("เช่น 50 หรือ 100.50", "#6B7280", "xs"),
    flexButton(`จ่ายเต็ม ${formatBaht(remaining)}`, { type: "postback", label: "จ่ายเต็ม", data: `pay:amount:${requestId}:${remaining}`, displayText: `จ่ายเต็ม ${formatBaht(remaining)}` }, "primary", "#2563EB"),
  ];

  if (remaining > 20) {
    bodyContents.push(
      flexButton(`จ่ายครึ่งหนึ่ง ${formatBaht(half)}`, { type: "postback", label: "จ่ายครึ่งหนึ่ง", data: `pay:amount:${requestId}:${half}`, displayText: `จ่ายครึ่งหนึ่ง ${formatBaht(half)}` }, "secondary", "#0891B2")
    );
  }

  bodyContents.push(flexButton("ยกเลิก", { type: "message", label: "ยกเลิก", text: "ยกเลิก" }, "secondary", "#6B7280"));
  return flexBubble(bodyContents);
}

function createPaymentMethodBubble(requestId: string, scheduleName: string, amount: number) {
  return flexBubble([
    flexHeader("เลือกวิธีชำระเงิน", scheduleName),
    flexSeparator(),
    metricBox("ยอดค้าง", formatBaht(amount), "#2563EB", "#EFF6FF", "xxl"),
    flexText("แตะเลือกช่องทางชำระเงินจากปุ่มใหญ่ด้านล่างได้เลยครับ", "#374151", "sm"),
    flexText("ถ้าเลือกโอนหรือวอลเล็ต ระบบจะส่ง QR พร้อมยอดเงินคงที่ให้สแกน", "#6B7280", "xs"),
    flexButton("K PLUS / โอนธนาคาร", { type: "postback", label: "K PLUS", data: `pay:method:${requestId}:kplus`, displayText: "เลือก K PLUS" }, "primary", "#059669"),
    flexButton("TrueMoney Wallet", { type: "postback", label: "TrueMoney", data: `pay:method:${requestId}:truemoney`, displayText: "เลือก TrueMoney" }, "primary", "#EA580C"),
    flexButton("เงินสด", { type: "postback", label: "เงินสด", data: `pay:method:${requestId}:cash`, displayText: "เลือกเงินสด" }, "secondary", "#2563EB"),
    flexButton("ยกเลิก", { type: "message", label: "ยกเลิก", text: "ยกเลิก" }, "secondary", "#6B7280"),
  ]);
}

async function handleMethodSelection(event: LineWebhookEvent, requestId: string, method: string) {
  if (!["kplus", "truemoney", "cash"].includes(method)) {
    await replyLineText(event.replyToken, await lineMessage("invalidPaymentMethod"));
    return;
  }

  const requests = await listRecords<Row>("line_payment_requests");
  const row = requests.find((request) => request.id === requestId);
  if (!row) {
    await replyLineText(event.replyToken, await lineMessage("paymentNotFound"));
    return;
  }

  const request = mapLinePaymentRequest(row);
  if (request.line_user_id !== event.source?.userId) {
    await replyLineText(event.replyToken, await lineMessage("paymentWrongLineUser"));
    return;
  }

  if (method === "cash") {
    await updateRecord<Row>("line_payment_requests", request.id, { method, status: "cash_pending" }, ["method", "status"]);
    await replyLineMessages(event.replyToken, [
      createFlexMessage("รับเรื่องชำระเงินสดไว้แล้ว", createCashPaymentBubble(request.amount, await lineMessage("cashPaymentReceived"))),
    ]);
    return;
  }

  await updateRecord<Row>("line_payment_requests", request.id, { method, status: "awaiting_slip" }, ["method", "status"]);
  const settings = await getRuntimeSettings();
  const payload = method === "truemoney"
    ? generateTrueMoneyPayload(request.amount, settings)
    : generatePayload(settings.promptPayId || DEFAULT_SETTINGS.promptPayId, { amount: request.amount });
  const qrUrl = settings.quickChartQrUrlTemplate.replace("{{payload}}", encodeURIComponent(payload));

  await replyLineMessages(event.replyToken, [
    createFlexMessage(`สแกนจ่าย ${formatMethod(method)}`, createQrPaymentBubble(method, request.amount, await lineMessage("qrPaymentInstruction"))),
    {
      type: "image",
      originalContentUrl: qrUrl,
      previewImageUrl: qrUrl,
    },
  ]);
}

function createCashPaymentBubble(amount: number, note: string) {
  return flexBubble([
    flexHeader("รับเรื่องชำระเงินสดแล้ว", "นำเงินไปชำระกับเหรัญญิก"),
    flexSeparator(),
    metricBox("ยอดเงิน", formatBaht(amount), "#2563EB", "#EFF6FF", "xxl"),
    flexText(note, "#374151", "sm"),
  ]);
}

function createQrPaymentBubble(method: string, amount: number, instruction: string) {
  const isKplus = method === "kplus";
  const instructionLines = instruction.split(/\r?\n/).filter(Boolean);
  return flexBubble([
    flexHeader(isKplus ? "สแกนจ่ายผ่าน K PLUS" : "สแกนจ่ายผ่าน TrueMoney", "QR ด้านล่างล็อกยอดเงินไว้แล้ว"),
    flexSeparator(),
    metricBox("ยอดเงิน", formatBaht(amount), isKplus ? "#059669" : "#EA580C", isKplus ? "#ECFDF5" : "#FFF7ED", "xxl"),
    ...instructionLines.map((line, index) => flexText(line, index === 0 ? "#374151" : "#6B7280", index === 0 ? "sm" : "xs")),
  ]);
}

async function handleSlipImage(event: LineWebhookEvent, messageId: string) {
  const activeRequest = (await listRecords<Row>("line_payment_requests"))
    .map(mapLinePaymentRequest)
    .filter((request) => request.line_user_id === event.source?.userId && request.status === "awaiting_slip")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (!activeRequest) {
    await replyLineText(event.replyToken, await lineMessage("noActiveSlipRequest"));
    return;
  }

  const image = await downloadLineMessageContent(messageId);
  const imageBuffer = Buffer.from(image.data);
  const settings = await getRuntimeSettings();
  const expectedReceiverAccounts = getExpectedSlipReceiverAccounts(activeRequest.method, settings);
  const expectedReceiverName = getExpectedSlipReceiverName(activeRequest.method, settings);
  const slipCheck = await analyzeSlipImage(imageBuffer, activeRequest.amount, {
    expectedReceiverAccounts,
    expectedReceiverName,
    paymentMethod: activeRequest.method,
    transactionAccountExclusions: [settings.promptPayId || DEFAULT_SETTINGS.promptPayId],
    contentType: image.contentType,
    remark: `line-payment-request:${activeRequest.id}`,
  });
  const [existingRequestRows, archivedSlipRows] = await Promise.all([
    listRecords<Row>("line_payment_requests"),
    listRecords<Row>("line_payment_slip_archives"),
  ]);
  const duplicateBlockingRequestRows = existingRequestRows.filter((row) =>
    String(row.id) !== activeRequest.id &&
    ["pending_slip_review", "pending_review"].includes(String(row.status || ""))
  );
  const existingSlipRows = [
    ...duplicateBlockingRequestRows,
    ...archivedSlipRows,
  ];
  const duplicateByQr = Boolean(
    slipCheck.qrPayload &&
      existingSlipRows.some((row) => row.slip_qr_payload === slipCheck.qrPayload)
  );
  const duplicateByHash = existingSlipRows.some((row) => row.slip_image_hash === slipCheck.imageHash);
  const duplicateByTransaction = Boolean(
    slipCheck.slipTransactionId &&
      existingSlipRows.some((row) => String(row.slip_transaction_id || "").toUpperCase() === slipCheck.slipTransactionId)
  );
  const duplicateSuspected = duplicateByQr || duplicateByHash || duplicateByTransaction || slipCheck.easySlipDuplicate;
  const shouldAutoRejectInvalidImage =
    settings.slipAutoRejectInvalidImage &&
    !slipCheck.easySlipVerified &&
    !slipCheck.qrReadable &&
    !slipCheck.slipTransactionId &&
    slipCheck.amountMatches !== true &&
    slipCheck.receiverAccountMatches !== true &&
    slipCheck.receiverNameMatches !== true;
  const canAutoRejectReceiverMismatch =
    activeRequest.method !== "truemoney" ||
    settings.trueMoneyAutoRejectReceiverMismatch;
  const autoRejectReasons = [
    slipCheck.amountMatches === false ? "ยอดเงินในสลิปไม่ตรงกับยอดที่เลือกไว้" : "",
    canAutoRejectReceiverMismatch && slipCheck.receiverAccountMatches === false ? "บัญชีปลายทางไม่ตรงกับที่ตั้งค่าไว้" : "",
    canAutoRejectReceiverMismatch && slipCheck.receiverNameMatches === false ? "ชื่อบัญชีปลายทางไม่ตรงกับที่ตั้งค่าไว้" : "",
    shouldAutoRejectInvalidImage ? "ระบบไม่พบ QR สลิป ยอดเงิน เลขธุรกรรม หรือข้อมูลบัญชีจากรูปที่ส่งมา" : "",
  ].filter(Boolean);
  const shouldAutoRejectSlip = autoRejectReasons.length > 0;
  const autoRejectReason = autoRejectReasons.join(" • ");
  // บังคับให้ผ่านการตรวจสอบและอนุมัติโดยเหรัญญิก (Treasurer approval) เสมอ
  const canAutoApprove = false;
  const slipStatus = shouldAutoRejectSlip
    ? "rejected"
    : duplicateSuspected
      ? "duplicate_suspected"
      : (!slipCheck.easySlipVerified && !slipCheck.qrReadable) || slipCheck.amountMatches === false
        ? "wrong_amount"
        : "pending_slip_review";
  const autoCheckResult = buildAutoCheckResult({
    duplicateByQr,
    duplicateByHash,
    duplicateByTransaction,
    duplicateByProvider: slipCheck.easySlipDuplicate,
    autoRejected: shouldAutoRejectSlip,
    amountMatches: slipCheck.amountMatches,
    qrReadable: slipCheck.qrReadable,
    qrAmount: slipCheck.qrAmount,
    detectedAmount: slipCheck.detectedAmount,
    amountSource: slipCheck.amountSource,
    receiverAccountMatches: slipCheck.receiverAccountMatches,
    receiverNameMatches: slipCheck.receiverNameMatches,
    detectedReceiverName: slipCheck.detectedReceiverName,
    rawDetectedReceiverName: slipCheck.rawDetectedReceiverName,
    slipTransactionId: slipCheck.slipTransactionId,
    provider: slipCheck.provider,
    providerMethod: slipCheck.easySlipMethod,
    providerError: slipCheck.easySlipError,
    autoApproved: canAutoApprove,
  });

  const proof = await storeSlipImage({
    requestId: activeRequest.id,
    contentType: image.contentType,
    data: imageBuffer,
  });

  await updateRecord<Row>(
    "line_payment_requests",
    activeRequest.id,
    {
      status: shouldAutoRejectSlip ? "rejected" : "pending_slip_review",
      slip_status: slipStatus,
      slip_url: proof.url,
      slip_pathname: proof.pathname,
      slip_qr_payload: slipCheck.qrPayload ?? null,
      slip_image_hash: slipCheck.imageHash,
      slip_transaction_id: slipCheck.slipTransactionId ?? null,
      slip_ocr_text: slipCheck.ocrText ?? null,
      slip_auto_check_result: autoCheckResult,
      reject_reason: shouldAutoRejectSlip ? autoRejectReason : null,
      reviewed_by: null,
      reviewed_at: null,
    },
    [
      "status",
      "slip_status",
      "slip_url",
      "slip_pathname",
      "slip_qr_payload",
      "slip_image_hash",
      "slip_transaction_id",
      "slip_ocr_text",
      "slip_auto_check_result",
      "reject_reason",
      "reviewed_by",
      "reviewed_at",
    ]
  );

  if (canAutoApprove) {
    await approveLinePaymentRequest({
      requestId: activeRequest.id,
      reviewerLineUserId: "system-auto-slip",
      notifyStudent: false,
    });
    await replyLineText(event.replyToken, await lineMessage("slipAutoApproved"));
    return;
  }

  if (shouldAutoRejectSlip) {
    await replyLineText(event.replyToken, await lineMessage("slipAutoRejected", { reason: autoRejectReason }));
    await cleanupAutoRejectedPaymentRequest(activeRequest.id, proof.pathname);
    return;
  }

  await replyLineText(event.replyToken, duplicateSuspected
    ? await lineMessage("slipDuplicateSuspected")
    : await lineMessage("slipPendingReview")
  );
}

async function cleanupAutoRejectedPaymentRequest(requestId: string, slipPathname: string | undefined) {
  await deleteRecord("line_payment_requests", requestId);
  if (!slipPathname) return;

  await deleteSlipImages([slipPathname]).catch((error) => {
    console.error("Failed to delete auto-rejected slip image", error);
  });
}

async function cancelActivePayment(event: LineWebhookEvent) {
  const student = await getStudentByLineUserId(event.source?.userId);
  if (!student) {
    await replyRegisterPrompt(event);
    return;
  }

  const activeRequests = (await listRecords<Row>("line_payment_requests"))
    .map(mapLinePaymentRequest)
    .filter((request) =>
      request.line_user_id === event.source?.userId &&
      ["selecting", "awaiting_slip", "cash_pending"].includes(request.status)
    );

  if (activeRequests.length === 0) {
    await replyLineText(event.replyToken, await lineMessage("paymentCancelEmpty"));
    return;
  }

  await Promise.all(activeRequests.map((request) => deleteRecord("line_payment_requests", request.id)));
  await replyLineText(event.replyToken, await lineMessage("paymentCancelSuccess"));
}

async function showStudentStatus(event: LineWebhookEvent) {
  const student = await getStudentByLineUserId(event.source?.userId);
  if (!student) {
    await replyRegisterPrompt(event);
    return;
  }

  const overview = await getStudentPaymentOverview(student.id);
  const totalDebt = overview.debts.reduce((sum, debt) => sum + debt.remaining, 0);
  const altText = totalDebt > 0
    ? `สถานะของคุณ: ค้าง ${formatBaht(totalDebt)} จาก ${overview.debts.length} รายการ`
    : "สถานะของคุณ: ไม่มีรายการค้างชำระ";

  await replyLineMessages(event.replyToken, [
    createFlexMessage(altText, createStudentStatusBubble(student, overview)),
  ]);
}

async function showStudentHistory(event: LineWebhookEvent) {
  const student = await getStudentByLineUserId(event.source?.userId);
  if (!student) {
    await replyRegisterPrompt(event);
    return;
  }

  const [scheduleRows, transactionRows] = await Promise.all([
    listRecords<Row>("schedules"),
    listRecords<Row>("transactions"),
  ]);
  const scheduleById = new Map(scheduleRows.map((row) => {
    const schedule = mapSchedule(row);
    return [schedule.id, schedule];
  }));
  const transactions = transactionRows
    .map(mapTransaction)
    .filter((transaction) => transaction.source === "schedule" && transaction.kind === "income" && transaction.student_id === student.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  await replyLineMessages(event.replyToken, [
    createFlexMessage(
      transactions.length > 0 ? `ประวัติการชำระเงิน ${transactions.length} รายการ` : "ยังไม่มีประวัติการชำระเงิน",
      createStudentHistoryBubble(student, transactions, scheduleById)
    ),
  ]);
}

async function showClassroomTotal(event: LineWebhookEvent) {
  const student = await getStudentByLineUserId(event.source?.userId);
  if (!student) {
    await replyRegisterPrompt(event);
    return;
  }

  const transactions = (await listRecords<Row>("transactions")).map(mapTransaction);
  const summary = calculateClassroomMoneySummary(transactions);

  await replyLineMessages(event.replyToken, [
    createFlexMessage(
      `ยอดเงินห้องรวม ${formatBaht(summary.total)}`,
      createClassroomTotalBubble(summary)
    ),
  ]);
}

async function getStudentPaymentOverview(studentId: string) {
  const [scheduleRows, transactionRows] = await Promise.all([
    listRecords<Row>("schedules"),
    listRecords<Row>("transactions"),
  ]);
  const schedules = scheduleRows.map(mapSchedule).filter((schedule) => schedule.student_ids.includes(studentId));
  const transactions = transactionRows.map(mapTransaction);

  const items = schedules
    .map((schedule) => {
      const paid = transactions
        .filter((transaction) => transaction.source === "schedule" && transaction.kind === "income" && transaction.schedule_id === schedule.id && transaction.student_id === studentId)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      return {
        schedule,
        paid,
        remaining: Math.max(0, Math.round((schedule.amount_per_item - paid) * 100) / 100),
      };
    })
    .sort((a, b) => String(a.schedule.end_date || a.schedule.start_date).localeCompare(String(b.schedule.end_date || b.schedule.start_date)));

  return {
    totalSchedules: items.length,
    paidSchedules: items.filter((item) => item.remaining <= 0),
    debts: items.filter((item) => item.remaining > 0),
  };
}

function calculateClassroomMoneySummary(transactions: ReturnType<typeof mapTransaction>[]) {
  const summary = {
    total: 0,
    income: 0,
    expense: 0,
    kplus: 0,
    cash: 0,
    truemoney: 0,
  };

  for (const transaction of transactions) {
    if (transaction.kind === "income") {
      summary.income += transaction.amount;
      summary.total += transaction.amount;
      addMethodAmount(summary, normalizeTransactionMethod(transaction), transaction.amount);
    } else if (transaction.kind === "expense") {
      summary.expense += transaction.amount;
      summary.total -= transaction.amount;
      addMethodAmount(summary, normalizeTransactionMethod(transaction), -transaction.amount);
    } else if (transaction.kind === "transfer") {
      addMethodAmount(summary, methodFromPocketId(transaction.source_pocket_id), -transaction.amount);
      addMethodAmount(summary, methodFromPocketId(transaction.destination_pocket_id), transaction.amount);
    }
  }

  return summary;
}

function addMethodAmount(
  summary: { kplus: number; cash: number; truemoney: number },
  method: string | undefined,
  amount: number
) {
  if (method === "kplus") summary.kplus += amount;
  if (method === "cash") summary.cash += amount;
  if (method === "truemoney") summary.truemoney += amount;
}

function methodFromPocketId(pocketId: string | undefined) {
  if (pocketId === "pocket-kplus") return "kplus";
  if (pocketId === "pocket-cash") return "cash";
  if (pocketId === "pocket-truemoney") return "truemoney";
  return undefined;
}

function normalizeTransactionMethod(transaction: ReturnType<typeof mapTransaction>) {
  return transaction.method === "kplus" || transaction.method === "cash" || transaction.method === "truemoney"
    ? transaction.method
    : methodFromPocketId(transaction.pocket_id);
}

function createStudentStatusBubble(student: ReturnType<typeof mapStudent>, overview: Awaited<ReturnType<typeof getStudentPaymentOverview>>) {
  const totalDebt = overview.debts.reduce((sum, debt) => sum + debt.remaining, 0);
  const bodyContents: LineFlexBox[] = [
    flexHeader("สถานะการชำระเงิน", `${student.prefix} ${student.first_name} ${student.last_name}`),
    flexText(`เลขที่ ${student.number}${student.nick_name ? ` (${student.nick_name})` : ""}`, "#6B7280", "sm"),
    flexSeparator(),
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        metricBox("ยอดค้าง", formatBaht(totalDebt), "#DC2626", "#FEF2F2"),
        metricBox("ค้าง", `${overview.debts.length} รายการ`, "#EA580C", "#FFF7ED"),
        metricBox("จ่ายแล้ว", `${overview.paidSchedules.length}/${overview.totalSchedules}`, "#059669", "#ECFDF5"),
      ],
    },
  ];

  if (overview.debts.length === 0) {
    bodyContents.push(emptyStateBox("ไม่มีรายการค้างชำระครับ ✅", "กระเป๋าสตางค์รอดแล้ววันนี้"));
  } else {
    bodyContents.push(flexSectionTitle("แตะเลือกรายการเพื่อชำระเงิน"));
    bodyContents.push(...overview.debts.slice(0, 8).map((debt) =>
      paymentDebtButton(
        debt.schedule.name,
        debt.remaining,
        debt.schedule.end_date || debt.schedule.start_date,
        `pay:schedule:${debt.schedule.id}`
      )
    ));
    if (overview.debts.length > 8) {
      bodyContents.push(flexText(`และอีก ${overview.debts.length - 8} รายการ`, "#6B7280", "xs"));
    }
    bodyContents.push(flexButton("เปิดเมนูชำระเงิน", { type: "message", label: "ชำระเงิน", text: "ชำระเงิน" }, "primary", "#2563EB"));
  }

  return flexBubble(bodyContents);
}

function createStudentHistoryBubble(
  student: ReturnType<typeof mapStudent>,
  transactions: ReturnType<typeof mapTransaction>[],
  scheduleById: Map<string, ReturnType<typeof mapSchedule>>
) {
  const totalPaid = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const bodyContents: LineFlexBox[] = [
    flexHeader("ประวัติการชำระเงิน", `${student.prefix} ${student.first_name} ${student.last_name}`),
    flexText(`เลขที่ ${student.number}${student.nick_name ? ` (${student.nick_name})` : ""}`, "#6B7280", "sm"),
    flexSeparator(),
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        metricBox("รวมที่จ่าย", formatBaht(totalPaid), "#2563EB", "#EFF6FF"),
        metricBox("จำนวน", `${transactions.length} รายการ`, "#0891B2", "#ECFEFF"),
      ],
    },
  ];

  if (transactions.length === 0) {
    bodyContents.push(emptyStateBox("ยังไม่มีประวัติการชำระเงินครับ", "เมื่อเหรัญญิกอนุมัติแล้ว รายการจะแสดงตรงนี้"));
  } else {
    bodyContents.push(flexSectionTitle("ล่าสุด"));
    bodyContents.push(...transactions.slice(0, 10).map((transaction) => {
      const scheduleName = transaction.schedule_id ? scheduleById.get(transaction.schedule_id)?.name : undefined;
      return historyRow(scheduleName || transaction.name, transaction.amount, transaction.method, transaction.created_at);
    }));
  }

  return flexBubble(bodyContents);
}

function createClassroomTotalBubble(summary: ReturnType<typeof calculateClassroomMoneySummary>) {
  return flexBubble([
    flexHeader("ยอดเงินห้องเรียน", "ภาพรวมเงินทั้งหมดของห้อง"),
    flexSeparator(),
    metricBox("ยอดคงเหลือรวม", formatBaht(summary.total), "#2563EB", "#EFF6FF", "xxl"),
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        metricBox("K PLUS", formatBaht(summary.kplus), "#059669", "#ECFDF5"),
        metricBox("Cash", formatBaht(summary.cash), "#2563EB", "#EFF6FF"),
      ],
    },
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        metricBox("TrueMoney", formatBaht(summary.truemoney), "#EA580C", "#FFF7ED"),
        metricBox("รายจ่าย", formatBaht(summary.expense), "#DC2626", "#FEF2F2"),
      ],
    },
    metricBox("รายรับทั้งหมด", formatBaht(summary.income), "#0891B2", "#ECFEFF"),
    flexText(`อัปเดต: ${formatDateTimeThai(new Date().toISOString())}`, "#9CA3AF", "xs"),
  ]);
}

function createFlexMessage(altText: string, bubble: LineFlexBox): LineMessage {
  return {
    type: "flex",
    altText: truncateLabel(altText, 390),
    contents: bubble,
  };
}

function flexBubble(bodyContents: LineFlexBox[]): LineFlexBox {
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "18px",
      contents: bodyContents,
    },
  };
}

function flexHeader(title: string, subtitle: string): LineFlexBox {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      { type: "text", text: title, weight: "bold", size: "xl", color: "#111827" },
      { type: "text", text: subtitle, size: "sm", color: "#4B5563", wrap: true },
    ],
  };
}

function metricBox(label: string, value: string, color: string, backgroundColor: string, size = "lg"): LineFlexBox {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "12px",
    cornerRadius: "16px",
    backgroundColor,
    contents: [
      { type: "text", text: label, size: "xs", color: "#6B7280", wrap: true },
      { type: "text", text: value, size, weight: "bold", color, wrap: true },
    ],
  };
}

function paymentDebtButton(name: string, amount: number, dueDate: string | undefined, data: string): LineFlexBox {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "14px",
    cornerRadius: "16px",
    borderWidth: "1px",
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    action: {
      type: "postback",
      label: truncateLabel(`ชำระ ${name}`, 40),
      data,
      displayText: `ชำระ ${name}`,
    },
    contents: [
      { type: "text", text: name, size: "md", weight: "bold", color: "#111827", wrap: true },
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          { type: "text", text: `ครบกำหนด: ${formatDateThai(dueDate)}`, size: "xs", color: "#6B7280", wrap: true, flex: 1 },
          { type: "text", text: formatBaht(amount), size: "sm", weight: "bold", color: "#DC2626", align: "end", flex: 0 },
        ],
      },
      { type: "text", text: "แตะเพื่อเลือกจ่ายรายการนี้", size: "xs", color: "#2563EB", weight: "bold", wrap: true },
    ],
  };
}

function historyRow(name: string, amount: number, method: string | undefined, createdAt: string): LineFlexBox {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "10px",
    cornerRadius: "14px",
    borderWidth: "1px",
    borderColor: "#E5E7EB",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        contents: [
          { type: "text", text: name, size: "sm", weight: "bold", color: "#111827", wrap: true, flex: 1 },
          { type: "text", text: formatBaht(amount), size: "sm", weight: "bold", color: "#059669", align: "end", flex: 0 },
        ],
      },
      { type: "text", text: `${formatMethod(method)} • ${formatDateTimeThai(createdAt)}`, size: "xs", color: "#6B7280", wrap: true },
    ],
  };
}

function flexSectionTitle(text: string): LineFlexBox {
  return { type: "text", text, weight: "bold", size: "md", color: "#111827", margin: "md" };
}

function flexText(text: string, color: string, size: string): LineFlexBox {
  return { type: "text", text, color, size, wrap: true };
}

function flexSeparator(): LineFlexBox {
  return { type: "separator", color: "#E5E7EB" };
}

function flexButton(
  text: string,
  action: Record<string, unknown>,
  style: "primary" | "secondary",
  color: string
): LineFlexBox {
  return {
    type: "button",
    style,
    height: "md",
    color,
    margin: "sm",
    action: {
      ...action,
      label: truncateLabel(text, 40),
    },
  };
}

function emptyStateBox(title: string, subtitle: string): LineFlexBox {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "16px",
    cornerRadius: "18px",
    backgroundColor: "#F8FAFC",
    contents: [
      { type: "text", text: title, weight: "bold", size: "md", color: "#111827", align: "center", wrap: true },
      { type: "text", text: subtitle, size: "sm", color: "#6B7280", align: "center", wrap: true },
    ],
  };
}

function parseRegistrationNumber(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(?:ลงทะเบียน)?\s*(\d{1,3})$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function isPayCommand(text: string, settings?: AppPublicSettings) {
  return matchesCommand(text, ["ชำระเงิน", "จ่ายเงิน", "pay", "PAY_MENU", settings?.linePayAction.text]);
}

function isCancelCommand(text: string) {
  return ["ยกเลิก", "cancel", "CANCEL_PAYMENT"].includes(text.trim());
}

function isRegistrationHelpCommand(text: string, settings?: AppPublicSettings) {
  return matchesCommand(text, ["ลงทะเบียน", settings?.lineRegisterAction.text]);
}

function isStatusCommand(text: string, settings?: AppPublicSettings) {
  return matchesCommand(text, ["เมนูสถานะ", "สถานะ", "STATUS_MENU", settings?.lineStatusAction.text]);
}

function isHistoryCommand(text: string, settings?: AppPublicSettings) {
  return matchesCommand(text, ["เมนูประวัติ", "ประวัติ", "HISTORY_MENU", settings?.lineHistoryAction.text]);
}

function isTotalCommand(text: string, settings?: AppPublicSettings) {
  return matchesCommand(text, ["เมนูยอดรวม", "ยอดรวม", "TOTAL_MENU", settings?.lineTotalAction.text]);
}

function isCoreTextCommand(text: string, settings?: AppPublicSettings) {
  return isPayCommand(text, settings) || isCancelCommand(text) || isStatusCommand(text, settings) || isHistoryCommand(text, settings) || isTotalCommand(text, settings);
}

function isRegistrationText(text: string, settings?: AppPublicSettings) {
  return isRegistrationHelpCommand(text, settings) || parseRegistrationNumber(text) !== null;
}

function matchesCommand(text: string, commands: Array<string | undefined>) {
  const normalized = text.trim();
  return commands.some((command) => command?.trim() === normalized);
}

async function replyRegisterPrompt(event: LineWebhookEvent) {
  await linkLineRichMenuByName(event.source?.userId, (await getRuntimeSettings()).lineRegisterRichMenuName);
  await replyLineText(event.replyToken, await lineMessage("mustRegister"));
}

async function getStudentByLineUserId(lineUserId: string | undefined) {
  if (!lineUserId) return null;
  const students = (await listRecords<Row>("students")).map(mapStudent);
  return students.find((student) => student.line_user_id === lineUserId) || null;
}

async function getUnpaidSchedulesForStudent(studentId: string) {
  const [scheduleRows, transactionRows] = await Promise.all([
    listRecords<Row>("schedules"),
    listRecords<Row>("transactions"),
  ]);
  const schedules = scheduleRows.map(mapSchedule).filter((schedule) => schedule.student_ids.includes(studentId));
  const transactions = transactionRows.map(mapTransaction);

  return schedules
    .map((schedule) => {
      const paid = transactions
        .filter((transaction) => transaction.source === "schedule" && transaction.schedule_id === schedule.id && transaction.student_id === studentId)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      return {
        schedule,
        paid,
        remaining: Math.max(0, Math.round((schedule.amount_per_item - paid) * 100) / 100),
      };
    })
    .filter((item) => item.remaining > 0)
    .sort((a, b) => String(a.schedule.end_date || a.schedule.start_date).localeCompare(String(b.schedule.end_date || b.schedule.start_date)));
}

function buildAutoCheckResult({
  duplicateByQr,
  duplicateByHash,
  duplicateByTransaction,
  duplicateByProvider,
  autoRejected,
  amountMatches,
  qrReadable,
  qrAmount,
  detectedAmount,
  amountSource,
  receiverAccountMatches,
  receiverNameMatches,
  detectedReceiverName,
  rawDetectedReceiverName,
  slipTransactionId,
  provider,
  providerMethod,
  providerError,
  autoApproved,
}: {
  duplicateByQr: boolean;
  duplicateByHash: boolean;
  duplicateByTransaction: boolean;
  duplicateByProvider: boolean;
  autoRejected: boolean;
  amountMatches: boolean | null;
  qrReadable: boolean;
  qrAmount?: number;
  detectedAmount?: number;
  amountSource: "easyslip" | "qr" | "ocr" | null;
  receiverAccountMatches: boolean | null;
  receiverNameMatches: boolean | null;
  detectedReceiverName?: string;
  rawDetectedReceiverName?: string;
  slipTransactionId?: string;
  provider: "easyslip" | "local";
  providerMethod?: "payload" | "image";
  providerError?: string;
  autoApproved: boolean;
}) {
  const parts: string[] = [];
  parts.push(provider === "easyslip"
    ? `ตรวจผ่าน EasySlip API${providerMethod === "payload" ? " ด้วย QR payload" : providerMethod === "image" ? " ด้วยรูปสลิป" : ""}`
    : "ตรวจด้วยระบบสำรองในแอป");
  if (providerError) parts.push(`EasySlip ใช้งานไม่ได้: ${providerError}`);
  if (autoRejected) parts.push("ปฏิเสธอัตโนมัติ");
  if (duplicateByQr || duplicateByHash || duplicateByTransaction || duplicateByProvider) {
    const source = [
      duplicateByProvider ? "EasySlip" : "",
      duplicateByQr ? "QR" : "",
      duplicateByHash ? "รูปภาพ" : "",
      duplicateByTransaction ? "เลขธุรกรรม" : "",
    ].filter(Boolean).join("และ");
    parts.push(`สงสัยสลิปซ้ำจาก${source}`);
  }
  if (!qrReadable) parts.push("อ่าน QR จากสลิปไม่ได้");
  if (amountMatches === false) {
    const sourceLabel = amountSource === "easyslip" ? "EasySlip" : amountSource === "ocr" ? "รูปสลิป" : "QR";
    const checkedAmount = typeof detectedAmount === "number" ? detectedAmount : qrAmount;
    parts.push(`ยอดใน${sourceLabel}ไม่ตรง${typeof checkedAmount === "number" ? ` (${formatBaht(checkedAmount)})` : ""}`);
  }
  if (amountMatches === null) parts.push("ยังยืนยันยอดเงินจากสลิปไม่ได้");
  if (!slipTransactionId) parts.push("ยังหาเลขธุรกรรมจากสลิปไม่ได้");
  if (receiverAccountMatches === false) parts.push("บัญชีปลายทางไม่ตรงกับที่ตั้งค่าไว้");
  if (receiverAccountMatches === null) parts.push("ยังตรวจบัญชีปลายทางไม่ได้");
  if (receiverNameMatches === false) parts.push("ชื่อบัญชีปลายทางไม่ตรงกับที่ตั้งค่าไว้");
  if (receiverNameMatches === null) parts.push("ยังตรวจชื่อบัญชีปลายทางไม่ได้");
  if (detectedReceiverName) parts.push(`ชื่อที่อ่านได้: ${detectedReceiverName}`);
  if (rawDetectedReceiverName && rawDetectedReceiverName !== detectedReceiverName) {
    parts.push(`OCR อ่านเป็น: ${rawDetectedReceiverName}`);
  }
  if (autoApproved) {
    return amountMatches === true
      ? "ผ่านเงื่อนไขอัตโนมัติ: EasySlip/QR ใหม่ เลขธุรกรรมใหม่ และยอดตรงกับรายการ"
      : "ผ่านเงื่อนไขอัตโนมัติ: EasySlip/QR ใหม่ เลขธุรกรรมใหม่ และไม่พบสลิปซ้ำ";
  }
  if (parts.length === 0) return "อ่าน QR ได้ ไม่พบรายการซ้ำ และยอดตรงกับรายการ";
  return parts.join(" • ");
}

function getExpectedSlipReceiverAccounts(method: string | undefined, settings: AppPublicSettings) {
  const configured = method === "truemoney"
    ? [
      settings.trueMoneyReceiverPhone,
    ].flatMap((value) => splitEnvList(value))
    : [
      settings.promptPayId || DEFAULT_SETTINGS.promptPayId,
      settings.bankReceiverAccount,
      settings.bankReceiverPromptPay,
    ].flatMap((value) => splitEnvList(value));

  return Array.from(new Set(configured.filter(Boolean)));
}

function getExpectedSlipReceiverName(method: string | undefined, settings: AppPublicSettings) {
  return (
    method === "truemoney"
      ? settings.trueMoneyReceiverName.trim() || settings.bankReceiverName.trim()
      : settings.bankReceiverName.trim()
  ) || undefined;
}

function splitEnvList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truncateLabel(label: string, maxLength: number) {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

function studentDisplayName(student: ReturnType<typeof mapStudent>) {
  return `${student.prefix} ${student.first_name} ${student.last_name}`.trim();
}

function formatBaht(amount: number) {
  return `${amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
}

function formatMethod(method: string | undefined) {
  if (method === "kplus") return "K PLUS";
  if (method === "cash") return "เงินสด";
  if (method === "truemoney") return "TrueMoney";
  return "ไม่ระบุช่องทาง";
}

function formatDateThai(value: string | undefined) {
  if (!value) return "ยังไม่ระบุ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ยังไม่ระบุ";
  return date.toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTimeThai(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isValidLineSignature(bodyText: string, signature: string, channelSecret: string) {
  if (!signature) return false;

  const digest = createHmac("sha256", channelSecret).update(bodyText).digest("base64");
  const signatureBuffer = Buffer.from(signature);
  const digestBuffer = Buffer.from(digest);

  return signatureBuffer.length === digestBuffer.length && timingSafeEqual(signatureBuffer, digestBuffer);
}

async function replyLineText(replyToken: string | undefined, text: string) {
  return replyLineMessages(replyToken, [{ type: "text", text }]);
}

async function replyLineMessages(replyToken: string | undefined, messages: Array<Record<string, unknown>>) {
  const token = (await getRuntimeSettings()).lineChannelAccessToken;
  if (!token || !replyToken) return;

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE reply API ${response.status}${body ? `: ${body}` : ""}`);
  }
}

async function downloadLineMessageContent(messageId: string) {
  const token = (await getRuntimeSettings()).lineChannelAccessToken;
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");

  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE content API ${response.status}${body ? `: ${body}` : ""}`);
  }

  return {
    contentType: response.headers.get("content-type") || "image/jpeg",
    data: await response.arrayBuffer(),
  };
}

import { createHmac, timingSafeEqual } from "crypto";
import generatePayload from "promptpay-qr";
import { badRequest, ok, serverError } from "@/lib/api/response";
import { createRecord, listRecords, updateRecord, type Row } from "@/lib/supabase/server";
import { mapLinePaymentRequest, mapSchedule, mapStudent, mapTransaction } from "@/lib/supabase/mappers";
import { storePaymentProofImage } from "@/lib/server/paymentProofStorage";
import { linkLineRichMenuByName } from "@/lib/server/line";

const PROMPTPAY_ID = "004666006046829";

const TRUEMONEY_TEMPLATE_PREFIX = "00020101021229390016A000000677010111031514000098913543353037645";
const TRUEMONEY_TEMPLATE_SUFFIX = "5802TH6304";

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

function generateTrueMoneyPayload(amount: number): string {
  const amountStr = amount.toFixed(2);
  const amountLength = amountStr.length.toString().padStart(2, "0");
  const dataWithoutCrc = `${TRUEMONEY_TEMPLATE_PREFIX}4${amountLength}${amountStr}${TRUEMONEY_TEMPLATE_SUFFIX}`;
  const crc = crc16CcittFalse(dataWithoutCrc);
  return `${dataWithoutCrc}${crc}`;
}
const REGISTERED_RICH_MENU_NAME = "Classroom Finance Student Menu";
const REGISTER_RICH_MENU_NAME = "Classroom Finance Register Menu";

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
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
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
  if (isPayCommand(text)) {
    await showPayMenu(event);
    return;
  }
  if (isCancelCommand(text)) {
    await cancelActivePayment(event);
    return;
  }
  if (isStatusCommand(text)) {
    await showStudentStatus(event);
    return;
  }
  if (isHistoryCommand(text)) {
    await showStudentHistory(event);
    return;
  }
  if (isTotalCommand(text)) {
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

  if (isCoreTextCommand(text) || isRegistrationText(text) || text.startsWith("pay:")) {
    await handleAction(event, text);
  }
}

async function handleAction(event: LineWebhookEvent, action: string) {
  if (!event.source?.userId) return;
  const normalized = action.trim();
  const number = parseRegistrationNumber(normalized);

  if (!number) {
    if (isRegistrationHelpCommand(normalized)) {
      const registeredStudent = await getStudentByLineUserId(event.source.userId);
      if (registeredStudent) {
        const menuLink = await linkLineRichMenuByName(event.source.userId, REGISTERED_RICH_MENU_NAME);
        await replyLineText(event.replyToken, [
          "บัญชี LINE นี้ลงทะเบียนไว้แล้วครับ ✅",
          "ไม่ต้องสมัครซ้ำ บอทจำได้อยู่น้า",
          "",
          `${registeredStudent.prefix} ${registeredStudent.first_name} ${registeredStudent.last_name}`,
          `เลขที่ ${registeredStudent.number}`,
          "",
          menuLink.ok ? "เมนูถูกเปลี่ยนเป็น ชำระเงิน / สถานะ / ประวัติ / ยอดรวม แล้วครับ" : "ยังเปลี่ยนเมนูไม่ได้ กรุณาให้เหรัญญิกรันตั้งค่า Rich Menu อีกครั้งนะครับ",
          "ถ้าต้องการเปลี่ยนเป็นคนอื่น ต้องให้เหรัญญิกลบ LINE User ID ในระบบก่อนนะครับ",
        ].join("\n"));
        return;
      }

      await linkLineRichMenuByName(event.source.userId, REGISTER_RICH_MENU_NAME);
      await replyLineText(event.replyToken, [
        "มาลงทะเบียน LINE กับระบบการเงินห้องเรียนกันครับ ✨",
        "พิมพ์เลขที่ของตัวเองตามตัวอย่างนี้ได้เลย",
        "",
        "ตัวอย่าง : 24",
        "",
        "พอลงทะเบียนเสร็จ จะกดเมนู ชำระเงิน ต่อได้ทันทีครับ 🚀",
      ].join("\n"));
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
    const menuLink = await linkLineRichMenuByName(event.source.userId, REGISTERED_RICH_MENU_NAME);
    const isSameNumber = registeredStudent.number === number;
    await replyLineText(event.replyToken, [
      "บัญชี LINE นี้ลงทะเบียนไว้แล้วครับ ✅",
      isSameNumber ? "คนนี้แหละ ใช่เลย ไม่ต้องลงซ้ำแล้วน้า" : "ตอนนี้ผูกอยู่กับ",
      "",
      `${registeredStudent.prefix} ${registeredStudent.first_name} ${registeredStudent.last_name}`,
      `เลขที่ ${registeredStudent.number}`,
      "",
      menuLink.ok ? (isSameNumber ? "กดเมนู ชำระเงิน ใช้งานต่อได้เลยครับ 💸" : "เมนูถูกเปลี่ยนเป็น ชำระเงิน / สถานะ / ประวัติ / ยอดรวม แล้วครับ") : "ยังเปลี่ยนเมนูไม่ได้ กรุณาให้เหรัญญิกรันตั้งค่า Rich Menu อีกครั้งนะครับ",
      isSameNumber
        ? ""
        : "เพื่อความปลอดภัย บัญชี LINE เดียวจะเปลี่ยนไปเป็นคนอื่นเองไม่ได้ครับ 🔐\nถ้าต้องการเปลี่ยนจริง ๆ ให้เหรัญญิกลบ LINE User ID ในระบบก่อนนะครับ",
    ].join("\n"));
    return;
  }

  const student = students.find((item) => item.number === number);

  if (!student) {
    await replyLineText(event.replyToken, [
      `ไม่พบนักเรียนเลขที่ ${number} ครับ 🧐`,
      "เหมือนเลขที่จะยังไม่อยู่ในระบบ หรืออาจพิมพ์ผิดนิดนึง",
      "",
      "ลองตรวจสอบเลขที่ แล้วส่งใหม่แบบนี้ได้เลย",
      `ลงทะเบียน ${number}`,
    ].join("\n"));
    return;
  }

  if (student.line_user_id && student.line_user_id !== event.source.userId) {
    await replyLineText(event.replyToken, [
      `เลขที่ ${student.number} มีบัญชี LINE ลงทะเบียนไว้แล้วครับ 👀`,
      "",
      "ถ้าต้องการเปลี่ยนไปใช้บัญชี LINE นี้แทน",
      "ให้เหรัญญิกลบ LINE User ID เดิมของนักเรียนคนนี้ในระบบก่อนนะครับ 🔐",
    ].join("\n"));
    return;
  }

  await updateRecord<Row>("students", student.id, { line_user_id: event.source.userId }, studentColumns);
  const menuLink = await linkLineRichMenuByName(event.source.userId, REGISTERED_RICH_MENU_NAME);

  await replyLineText(event.replyToken, [
    "ลงทะเบียนสำเร็จแล้วครับ 🎉",
    menuLink.ok
      ? "ยินดีต้อนรับเข้าสู่ระบบการเงินห้องเรียนแบบดิจิทัลสุด ๆ"
      : "ข้อมูลเข้าระบบเรียบร้อย แต่เมนูยังไม่ยอมเปลี่ยนตามนิดนึง 😅",
    "",
    `${student.prefix} ${student.first_name} ${student.last_name}`,
    `เลขที่ ${student.number}${student.nick_name ? ` (${student.nick_name})` : ""}`,
    "",
    menuLink.ok
      ? "เปลี่ยนเมนูเป็น ชำระเงิน / สถานะ / ประวัติ / ยอดรวม ให้เรียบร้อยแล้วครับ"
      : "รบกวนให้เหรัญญิกช่วยรันตั้งค่า Rich Menu อีกครั้งนะครับ",
    menuLink.ok
      ? "ต่อไปแจ้งเตือนเรื่องชำระเงินจะส่งมาที่บัญชีนี้นะครับ 🔔"
      : "ส่วนบัญชีนี้ ระบบจะใช้แจ้งเตือนกำหนดการชำระเงินได้ตามปกติครับ 🔔",
  ].join("\n"));
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
  message.quickReply = {
    items: [
      ...debts.slice(0, 12).map(({ schedule, remaining }) => ({
        type: "action",
        action: {
          type: "postback",
          label: truncateLabel(`${schedule.name} ${remaining.toLocaleString()}฿`, 20),
          data: `pay:schedule:${schedule.id}`,
          displayText: `ชำระ ${schedule.name}`,
        },
      })),
      quickMessage("ยกเลิก", "ยกเลิก"),
    ],
  };

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
      ["selecting", "awaiting_slip", "pending_review", "cash_pending"].includes(request.status)
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

  const quickItems: any[] = [
    quickPostback(
      truncateLabel(`จ่ายเต็ม ${formatBaht(debt.remaining)}`, 20),
      `pay:amount:${request.id}:${debt.remaining}`
    ),
  ];
  if (debt.remaining > 20) {
    const half = Math.round(debt.remaining / 2 * 100) / 100;
    quickItems.push(
      quickPostback(
        truncateLabel(`ครึ่งหนึ่ง ${formatBaht(half)}`, 20),
        `pay:amount:${request.id}:${half}`
      )
    );
  }
  quickItems.push(quickMessage("ยกเลิก", "ยกเลิก"));

  const message = createFlexMessage(
    `เลือกจำนวนเงิน ${debt.schedule.name}`,
    createAmountSelectionBubble(debt.schedule.name, debt.remaining)
  );
  message.quickReply = { items: quickItems };

  await replyLineMessages(event.replyToken, [message]);
}

async function handleAmountSelection(event: LineWebhookEvent, requestId: string, amount: number) {
  const requests = await listRecords<Row>("line_payment_requests");
  const row = requests.find((r) => r.id === requestId);
  if (!row) {
    await replyLineText(event.replyToken, [
      "ไม่พบรายการชำระเงินครับ 😅",
      "รายการอาจหมดอายุ หรือถูกยกเลิกไปแล้ว",
      "",
      "เริ่มใหม่ได้โดยพิมพ์ ชำระเงิน",
    ].join("\n"));
    return;
  }

  const request = mapLinePaymentRequest(row);
  if (request.line_user_id !== event.source?.userId) {
    await replyLineText(event.replyToken, "รายการนี้ไม่ตรงกับบัญชี LINE ของคุณครับ 🔐");
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
    createPaymentMethodBubble(scheduleName, roundedAmount)
  );
  message.quickReply = {
    items: [
      quickPostback("K PLUS", `pay:method:${request.id}:kplus`),
      quickPostback("TrueMoney", `pay:method:${request.id}:truemoney`),
      quickPostback("เงินสด", `pay:method:${request.id}:cash`),
      quickMessage("ยกเลิก", "ยกเลิก"),
    ],
  };

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
    bodyContents.push(flexSectionTitle("เลือกรายการจากปุ่มด้านล่าง"));
    bodyContents.push(...debts.slice(0, 8).map((debt) => paymentStatusRow(debt.schedule.name, debt.remaining, debt.schedule.end_date || debt.schedule.start_date, "#DC2626")));
    if (debts.length > 8) {
      bodyContents.push(flexText(`และอีก ${debts.length - 8} รายการ`, "#6B7280", "xs"));
    }
  }

  return flexBubble(bodyContents);
}

function createAmountSelectionBubble(scheduleName: string, remaining: number) {
  return flexBubble([
    flexHeader("เลือกจำนวนเงิน", scheduleName),
    flexSeparator(),
    metricBox("ยอดค้างทั้งหมด", formatBaht(remaining), "#2563EB", "#EFF6FF", "xxl"),
    flexText("เลือกจำนวนจากปุ่มด้านล่าง หรือพิมพ์จำนวนเงินเอง", "#374151", "sm"),
    flexText("เช่น 50 หรือ 100.50", "#6B7280", "xs"),
  ]);
}

function createPaymentMethodBubble(scheduleName: string, amount: number) {
  return flexBubble([
    flexHeader("เลือกวิธีชำระเงิน", scheduleName),
    flexSeparator(),
    metricBox("ยอดค้าง", formatBaht(amount), "#2563EB", "#EFF6FF", "xxl"),
    flexText("เลือก K PLUS, TrueMoney หรือเงินสดจากปุ่มด้านล่างได้เลยครับ", "#374151", "sm"),
    flexText("ถ้าเลือกโอนหรือวอลเล็ต ระบบจะส่ง QR พร้อมยอดเงินคงที่ให้สแกน", "#6B7280", "xs"),
  ]);
}

async function handleMethodSelection(event: LineWebhookEvent, requestId: string, method: string) {
  if (!["kplus", "truemoney", "cash"].includes(method)) {
    await replyLineText(event.replyToken, [
      "วิธีชำระเงินนี้ยังไม่ถูกต้องครับ 🧐",
      "ลองเลือกจากปุ่มที่ระบบแสดงให้อีกครั้งนะครับ",
    ].join("\n"));
    return;
  }

  const requests = await listRecords<Row>("line_payment_requests");
  const row = requests.find((request) => request.id === requestId);
  if (!row) {
    await replyLineText(event.replyToken, [
      "ไม่พบรายการชำระเงินครับ 😅",
      "รายการอาจหมดอายุ หรือถูกยกเลิกไปแล้ว",
      "",
      "เริ่มใหม่ได้โดยพิมพ์ ชำระเงิน",
    ].join("\n"));
    return;
  }

  const request = mapLinePaymentRequest(row);
  if (request.line_user_id !== event.source?.userId) {
    await replyLineText(event.replyToken, [
      "รายการนี้ไม่ตรงกับบัญชี LINE ของคุณครับ 🔐",
      "ระบบเลยไปต่อให้ไม่ได้ เพื่อความปลอดภัยนะครับ",
    ].join("\n"));
    return;
  }

  if (method === "cash") {
    await updateRecord<Row>("line_payment_requests", request.id, { method, status: "cash_pending" }, ["method", "status"]);
    await replyLineMessages(event.replyToken, [
      createFlexMessage("รับเรื่องชำระเงินสดไว้แล้ว", createCashPaymentBubble(request.amount)),
    ]);
    return;
  }

  await updateRecord<Row>("line_payment_requests", request.id, { method, status: "awaiting_slip" }, ["method", "status"]);
  const payload = method === "truemoney"
    ? generateTrueMoneyPayload(request.amount)
    : generatePayload(PROMPTPAY_ID, { amount: request.amount });
  const qrUrl = `https://quickchart.io/qr?size=600&margin=2&text=${encodeURIComponent(payload)}`;

  await replyLineMessages(event.replyToken, [
    createFlexMessage(`สแกนจ่าย ${formatMethod(method)}`, createQrPaymentBubble(method, request.amount)),
    {
      type: "image",
      originalContentUrl: qrUrl,
      previewImageUrl: qrUrl,
    },
  ]);
}

function createCashPaymentBubble(amount: number) {
  return flexBubble([
    flexHeader("รับเรื่องชำระเงินสดแล้ว", "นำเงินไปชำระกับเหรัญญิก"),
    flexSeparator(),
    metricBox("ยอดเงิน", formatBaht(amount), "#2563EB", "#EFF6FF", "xxl"),
    flexText("ระบบจะบันทึกยอดให้หลังจากเหรัญญิกยืนยันในระบบนะครับ 💵", "#374151", "sm"),
  ]);
}

function createQrPaymentBubble(method: string, amount: number) {
  const isKplus = method === "kplus";
  return flexBubble([
    flexHeader(isKplus ? "สแกนจ่ายผ่าน K PLUS" : "สแกนจ่ายผ่าน TrueMoney", "QR ด้านล่างล็อกยอดเงินไว้แล้ว"),
    flexSeparator(),
    metricBox("ยอดเงิน", formatBaht(amount), isKplus ? "#059669" : "#EA580C", isKplus ? "#ECFDF5" : "#FFF7ED", "xxl"),
    flexText("จ่ายเสร็จแล้ว ส่งรูปสลิปกลับมาในแชทนี้ได้เลยครับ 📸", "#374151", "sm"),
    flexText("บอทรอสลิปอยู่น้า", "#6B7280", "xs"),
  ]);
}

async function handleSlipImage(event: LineWebhookEvent, messageId: string) {
  const activeRequest = (await listRecords<Row>("line_payment_requests"))
    .map(mapLinePaymentRequest)
    .filter((request) => request.line_user_id === event.source?.userId && request.status === "awaiting_slip")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (!activeRequest) {
    await replyLineText(event.replyToken, [
      "ตอนนี้ยังไม่มีรายการที่รอสลิปครับ 👀",
      "บอทงงนิดนึงว่าสลิปนี้ของรายการไหน",
      "",
      "เริ่มจากเมนู ชำระเงิน ก่อน แล้วค่อยส่งสลิปเข้ามานะครับ",
    ].join("\n"));
    return;
  }

  const image = await downloadLineMessageContent(messageId);
  const proof = await storePaymentProofImage({
    requestId: activeRequest.id,
    contentType: image.contentType,
    data: image.data,
  });

  await updateRecord<Row>(
    "line_payment_requests",
    activeRequest.id,
    {
      status: "pending_review",
      slip_url: proof.url,
      slip_pathname: proof.pathname,
    },
    ["status", "slip_url", "slip_pathname"]
  );

  await replyLineText(event.replyToken, [
    "ได้รับสลิปแล้วครับ 📸✨",
    "บอทเก็บไว้ให้เรียบร้อย",
    "",
    "รอเหรัญญิกตรวจสอบและยืนยันในระบบนะครับ",
  ].join("\n"));
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
    await replyLineText(event.replyToken, [
      "ตอนนี้ไม่มีรายการชำระเงินที่กำลังดำเนินการอยู่ครับ 👀",
      "ไม่มีอะไรให้ยกเลิกแล้วน้า",
    ].join("\n"));
    return;
  }

  await Promise.all(activeRequests.map((request) =>
    updateRecord<Row>("line_payment_requests", request.id, { status: "expired", note: "Cancelled by LINE user" }, ["status", "note"])
  ));
  await replyLineText(event.replyToken, [
    "ยกเลิกรายการชำระเงินให้เรียบร้อยแล้วครับ ✅",
    "รายการนี้พักก่อน",
  ].join("\n"));
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

  const message = createFlexMessage(altText, createStudentStatusBubble(student, overview));
  if (overview.debts.length > 0) {
    message.quickReply = {
      items: [quickMessage("ชำระเงิน", "ชำระเงิน")],
    };
  }

  await replyLineMessages(event.replyToken, [message]);
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
    bodyContents.push(flexSectionTitle("รายการค้างชำระ"));
    bodyContents.push(...overview.debts.slice(0, 8).map((debt) => paymentStatusRow(debt.schedule.name, debt.remaining, debt.schedule.end_date || debt.schedule.start_date, "#DC2626")));
    if (overview.debts.length > 8) {
      bodyContents.push(flexText(`และอีก ${overview.debts.length - 8} รายการ`, "#6B7280", "xs"));
    }
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

function paymentStatusRow(name: string, amount: number, dueDate: string | undefined, color: string): LineFlexBox {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingAll: "10px",
    cornerRadius: "14px",
    borderWidth: "1px",
    borderColor: "#E5E7EB",
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        contents: [
          { type: "text", text: name, size: "sm", weight: "bold", color: "#111827", wrap: true },
          { type: "text", text: `ครบกำหนด: ${formatDateThai(dueDate)}`, size: "xs", color: "#6B7280", wrap: true },
        ],
      },
      { type: "text", text: formatBaht(amount), size: "sm", weight: "bold", color, align: "end", flex: 0 },
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

function isPayCommand(text: string) {
  return ["ชำระเงิน", "จ่ายเงิน", "pay", "PAY_MENU"].includes(text.trim());
}

function isCancelCommand(text: string) {
  return ["ยกเลิก", "cancel", "CANCEL_PAYMENT"].includes(text.trim());
}

function isRegistrationHelpCommand(text: string) {
  return ["ลงทะเบียน"].includes(text.trim());
}

function isStatusCommand(text: string) {
  return ["เมนูสถานะ", "สถานะ", "STATUS_MENU"].includes(text.trim());
}

function isHistoryCommand(text: string) {
  return ["เมนูประวัติ", "ประวัติ", "HISTORY_MENU"].includes(text.trim());
}

function isTotalCommand(text: string) {
  return ["เมนูยอดรวม", "ยอดรวม", "TOTAL_MENU"].includes(text.trim());
}

function isCoreTextCommand(text: string) {
  return isPayCommand(text) || isCancelCommand(text) || isStatusCommand(text) || isHistoryCommand(text) || isTotalCommand(text);
}

function isRegistrationText(text: string) {
  return isRegistrationHelpCommand(text) || parseRegistrationNumber(text) !== null;
}

async function replyRegisterPrompt(event: LineWebhookEvent) {
  await linkLineRichMenuByName(event.source?.userId, REGISTER_RICH_MENU_NAME);
  await replyLineText(event.replyToken, [
    "ยังไม่ได้ลงทะเบียน LINE กับระบบการเงินห้องเรียนนะครับ 👀",
    "กดเมนู ลงทะเบียน แล้วพิมพ์เลขที่ของตัวเองได้เลย",
    "",
    "เช่น ลงทะเบียน 24",
    "",
    "ลงทะเบียนแป๊บเดียว แล้วค่อยไปจ่ายเงินกันต่อครับ 💸",
  ].join("\n"));
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

function quickPostback(label: string, data: string) {
  return {
    type: "action",
    action: {
      type: "postback",
      label,
      data,
      displayText: label,
    },
  };
}

function quickMessage(label: string, text: string) {
  return {
    type: "action",
    action: {
      type: "message",
      label,
      text,
    },
  };
}

function truncateLabel(label: string, maxLength: number) {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
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
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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

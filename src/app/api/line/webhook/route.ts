import { createHmac, timingSafeEqual } from "crypto";
import generatePayload from "promptpay-qr";
import { badRequest, ok, serverError } from "@/lib/api/response";
import { createRecord, listRecords, updateRecord, type Row } from "@/lib/supabase/server";
import { mapLinePaymentRequest, mapSchedule, mapStudent, mapTransaction } from "@/lib/supabase/mappers";
import { storePaymentProofImage } from "@/lib/server/paymentProofStorage";
import { linkLineRichMenuByName } from "@/lib/server/line";

const PROMPTPAY_ID = "004666006046829";
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
          "บัญชี LINE นี้ลงทะเบียนแล้ว",
          `${registeredStudent.prefix} ${registeredStudent.first_name} ${registeredStudent.last_name}`,
          `เลขที่ ${registeredStudent.number}`,
          menuLink.ok ? "เมนูถูกเปลี่ยนเป็น ชำระเงิน / สถานะ / ประวัติ แล้ว" : "ยังเปลี่ยนเมนูไม่ได้ กรุณาให้เหรัญญิกรันตั้งค่า Rich Menu อีกครั้ง",
          "ถ้าต้องการเปลี่ยนคน ให้เหรัญญิกลบ LINE User ID ในระบบก่อน",
        ].join("\n"));
        return;
      }

      await linkLineRichMenuByName(event.source.userId, REGISTER_RICH_MENU_NAME);
      await replyLineText(event.replyToken, [
        "ลงทะเบียนบัญชี LINE กับระบบการเงินห้องเรียน",
        "พิมพ์เลขที่ของตัวเอง เช่น ลงทะเบียน 24",
        "หลังลงทะเบียนแล้วสามารถกดเมนูชำระเงินได้ทันที",
      ].join("\n"));
      return;
    }
    if (isPlaceholderMenuCommand(normalized)) {
      const student = await getStudentByLineUserId(event.source.userId);
      if (!student) {
        await replyRegisterPrompt(event);
        return;
      }
      await replyLineText(event.replyToken, [
        "เมนูนี้กำลังเตรียมใช้งาน",
        "ตอนนี้ใช้เมนูชำระเงินเพื่อดูรายการค้างชำระและส่งสลิปได้ก่อน",
      ].join("\n"));
      return;
    }
    if (normalized.startsWith("pay:schedule:")) {
      await handleScheduleSelection(event, normalized.replace("pay:schedule:", ""));
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
    await replyLineText(event.replyToken, [
      "บัญชี LINE นี้ลงทะเบียนแล้ว",
      `${registeredStudent.prefix} ${registeredStudent.first_name} ${registeredStudent.last_name}`,
      `เลขที่ ${registeredStudent.number}`,
      menuLink.ok ? "เมนูถูกเปลี่ยนเป็น ชำระเงิน / สถานะ / ประวัติ แล้ว" : "ยังเปลี่ยนเมนูไม่ได้ กรุณาให้เหรัญญิกรันตั้งค่า Rich Menu อีกครั้ง",
      registeredStudent.number === number
        ? "ไม่ต้องลงทะเบียนซ้ำ สามารถกดเมนูชำระเงินได้เลย"
        : "ไม่สามารถลงทะเบียนซ้ำเป็นนักเรียนคนอื่นได้ ถ้าต้องการเปลี่ยนให้เหรัญญิกลบ LINE User ID ในระบบก่อน",
    ].join("\n"));
    return;
  }

  const student = students.find((item) => item.number === number);

  if (!student) {
    await replyLineText(event.replyToken, `ไม่พบนักเรียนเลขที่ ${number}\nกรุณาตรวจสอบเลขที่แล้วส่งใหม่ เช่น ลงทะเบียน ${number}`);
    return;
  }

  if (student.line_user_id && student.line_user_id !== event.source.userId) {
    await replyLineText(event.replyToken, [
      `เลขที่ ${student.number} มีบัญชี LINE ที่ลงทะเบียนอยู่แล้ว`,
      "ถ้าต้องการเปลี่ยนบัญชี ให้เหรัญญิกลบ LINE User ID ของนักเรียนคนนี้ในระบบก่อน",
    ].join("\n"));
    return;
  }

  await updateRecord<Row>("students", student.id, { line_user_id: event.source.userId }, studentColumns);
  const menuLink = await linkLineRichMenuByName(event.source.userId, REGISTERED_RICH_MENU_NAME);

  await replyLineText(event.replyToken, [
    "ลงทะเบียน LINE สำเร็จ",
    `${student.prefix} ${student.first_name} ${student.last_name}`,
    `เลขที่ ${student.number}${student.nick_name ? ` (${student.nick_name})` : ""}`,
    menuLink.ok ? "เมนูถูกเปลี่ยนเป็น ชำระเงิน / สถานะ / ประวัติ แล้ว" : "ยังเปลี่ยนเมนูไม่ได้ กรุณาให้เหรัญญิกรันตั้งค่า Rich Menu อีกครั้ง",
    "ระบบจะใช้บัญชีนี้สำหรับแจ้งเตือนกำหนดการชำระเงิน",
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
    await replyLineText(event.replyToken, "ตอนนี้ไม่มีรายการค้างชำระ");
    return;
  }

  await replyLineMessages(event.replyToken, [
    {
      type: "text",
      text: "เลือกรายการที่ต้องการชำระ",
      quickReply: {
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
      },
    },
  ]);
}

async function handleScheduleSelection(event: LineWebhookEvent, scheduleId: string) {
  const student = await getStudentByLineUserId(event.source?.userId);
  if (!student) {
    await replyLineText(event.replyToken, "กรุณาลงทะเบียนก่อนใช้งาน\nตัวอย่าง: ลงทะเบียน 24");
    return;
  }

  const debt = (await getUnpaidSchedulesForStudent(student.id)).find((item) => item.schedule.id === scheduleId);
  if (!debt) {
    await replyLineText(event.replyToken, "รายการนี้ชำระครบแล้วหรือไม่อยู่ในรายการของคุณ");
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

  await replyLineMessages(event.replyToken, [
    {
      type: "text",
      text: [
        `รายการ: ${debt.schedule.name}`,
        `ยอดค้าง: ${debt.remaining.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
        "เลือกวิธีชำระเงิน",
      ].join("\n"),
      quickReply: {
        items: [
          quickPostback("K PLUS", `pay:method:${request.id}:kplus`),
          quickPostback("TrueMoney", `pay:method:${request.id}:truemoney`),
          quickPostback("เงินสด", `pay:method:${request.id}:cash`),
          quickMessage("ยกเลิก", "ยกเลิก"),
        ],
      },
    },
  ]);
}

async function handleMethodSelection(event: LineWebhookEvent, requestId: string, method: string) {
  if (!["kplus", "truemoney", "cash"].includes(method)) {
    await replyLineText(event.replyToken, "วิธีชำระเงินไม่ถูกต้อง");
    return;
  }

  const requests = await listRecords<Row>("line_payment_requests");
  const row = requests.find((request) => request.id === requestId);
  if (!row) {
    await replyLineText(event.replyToken, "ไม่พบรายการชำระเงิน กรุณาเริ่มใหม่โดยพิมพ์ ชำระเงิน");
    return;
  }

  const request = mapLinePaymentRequest(row);
  if (request.line_user_id !== event.source?.userId) {
    await replyLineText(event.replyToken, "รายการนี้ไม่ตรงกับบัญชี LINE ของคุณ");
    return;
  }

  if (method === "cash") {
    await updateRecord<Row>("line_payment_requests", request.id, { method, status: "cash_pending" }, ["method", "status"]);
    await replyLineText(event.replyToken, [
      "รับเรื่องชำระเงินสดแล้ว",
      `ยอดเงิน: ${request.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
      "กรุณาชำระกับเหรัญญิก ระบบจะบันทึกเมื่อเหรัญญิกยืนยัน",
    ].join("\n"));
    return;
  }

  await updateRecord<Row>("line_payment_requests", request.id, { method, status: "awaiting_slip" }, ["method", "status"]);
  const payload = generatePayload(PROMPTPAY_ID, { amount: request.amount });
  const qrUrl = `https://quickchart.io/qr?size=600&margin=2&text=${encodeURIComponent(payload)}`;

  await replyLineMessages(event.replyToken, [
    {
      type: "text",
      text: [
        method === "kplus" ? "สแกนจ่ายผ่าน K PLUS" : "สแกนจ่ายผ่าน TrueMoney",
        `ยอดเงิน: ${request.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
        "หลังชำระแล้ว ส่งรูปสลิปกลับมาในแชทนี้",
      ].join("\n"),
    },
    {
      type: "image",
      originalContentUrl: qrUrl,
      previewImageUrl: qrUrl,
    },
  ]);
}

async function handleSlipImage(event: LineWebhookEvent, messageId: string) {
  const activeRequest = (await listRecords<Row>("line_payment_requests"))
    .map(mapLinePaymentRequest)
    .filter((request) => request.line_user_id === event.source?.userId && request.status === "awaiting_slip")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (!activeRequest) {
    await replyLineText(event.replyToken, "ยังไม่มีรายการที่รอสลิป กรุณาเริ่มจากเมนูชำระเงินก่อน");
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

  await replyLineText(event.replyToken, "ได้รับสลิปแล้ว รอเหรัญญิกตรวจสอบและยืนยันในระบบ");
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
    await replyLineText(event.replyToken, "ไม่มีรายการชำระเงินที่กำลังดำเนินการอยู่");
    return;
  }

  await Promise.all(activeRequests.map((request) =>
    updateRecord<Row>("line_payment_requests", request.id, { status: "expired", note: "Cancelled by LINE user" }, ["status", "note"])
  ));
  await replyLineText(event.replyToken, "ยกเลิกรายการชำระเงินแล้ว");
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

function isPlaceholderMenuCommand(text: string) {
  return ["เมนูสถานะ", "สถานะ", "เมนูประวัติ", "ประวัติ"].includes(text.trim());
}

function isCoreTextCommand(text: string) {
  return isPayCommand(text) || isCancelCommand(text) || isPlaceholderMenuCommand(text);
}

function isRegistrationText(text: string) {
  return isRegistrationHelpCommand(text) || parseRegistrationNumber(text) !== null;
}

async function replyRegisterPrompt(event: LineWebhookEvent) {
  await linkLineRichMenuByName(event.source?.userId, REGISTER_RICH_MENU_NAME);
  await replyLineText(event.replyToken, [
    "ยังไม่ได้ลงทะเบียนบัญชี LINE กับระบบการเงินห้องเรียน",
    "กรุณากดเมนูลงทะเบียน แล้วพิมพ์เลขที่ของตัวเอง เช่น ลงทะเบียน 24",
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

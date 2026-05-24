import "server-only";

import { getRecord, listRecords, type Row } from "@/lib/supabase/server";
import { mapSchedule, mapStudent, mapTransaction } from "@/lib/supabase/mappers";
import { getRuntimeSettings, lineMessage } from "@/lib/server/appSettings";

type ScheduleNoticeKind = "announcement" | "reminder";
type NoticeStatus = "sent" | "missing_line_id" | "already_paid" | "failed";

export type ScheduleLineNoticeRecipient = {
  studentId: string;
  studentName: string;
  status: NoticeStatus;
  remaining: number;
  error?: string;
};

export type ScheduleLineNoticeResult = {
  scheduleId: string;
  kind: ScheduleNoticeKind;
  sent: number;
  skippedMissingLineId: number;
  alreadyPaid: number;
  failed: number;
  recipients: ScheduleLineNoticeRecipient[];
};

type LineMessage = Record<string, unknown>;
type FlexBox = Record<string, unknown>;

export async function sendScheduleLineNotices({
  scheduleId,
  studentIds,
  kind,
}: {
  scheduleId: string;
  studentIds?: string[];
  kind: ScheduleNoticeKind;
}): Promise<ScheduleLineNoticeResult | null> {
  const token = (await getRuntimeSettings()).lineChannelAccessToken;
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");

  const selectedStudentIds = Array.isArray(studentIds) && studentIds.length > 0
    ? new Set(studentIds.filter((studentId): studentId is string => typeof studentId === "string"))
    : null;

  const scheduleRow = await getRecord<Row>("schedules", scheduleId);
  if (!scheduleRow) return null;

  const schedule = mapSchedule(scheduleRow);
  const [studentRows, transactionRows] = await Promise.all([
    listRecords<Row>("students"),
    listRecords<Row>("transactions"),
  ]);
  const students = studentRows.map(mapStudent);
  const transactions = transactionRows.map(mapTransaction);
  const paidByStudent = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.source !== "schedule" || transaction.schedule_id !== schedule.id || !transaction.student_id) continue;
    paidByStudent.set(transaction.student_id, (paidByStudent.get(transaction.student_id) || 0) + transaction.amount);
  }

  const targetStudents = students
    .filter((student) => schedule.student_ids.includes(student.id))
    .filter((student) => !selectedStudentIds || selectedStudentIds.has(student.id))
    .sort((a, b) => a.number - b.number);

  const recipients: ScheduleLineNoticeRecipient[] = [];
  for (const student of targetStudents) {
    const paid = paidByStudent.get(student.id) || 0;
    const remaining = Math.max(0, Math.round((schedule.amount_per_item - paid) * 100) / 100);
    const studentName = `${student.prefix} ${student.first_name} ${student.last_name}`.trim();

    if (kind === "reminder" && remaining <= 0) {
      recipients.push({ studentId: student.id, studentName, status: "already_paid", remaining: 0 });
      continue;
    }

    if (!student.line_user_id) {
      recipients.push({ studentId: student.id, studentName, status: "missing_line_id", remaining });
      continue;
    }

    try {
      const footer = await lineMessage(kind === "announcement" ? "scheduleAnnouncementFooter" : "scheduleReminderFooter");
      await pushLineMessage({
        token,
        to: student.line_user_id,
        messages: [
          kind === "announcement"
            ? buildAnnouncementFlexMessage({ studentName, scheduleName: schedule.name, amount: schedule.amount_per_item, startDate: schedule.start_date, dueDate: schedule.end_date, footer })
            : buildReminderFlexMessage({ studentName, scheduleName: schedule.name, remaining, dueDate: schedule.end_date, footer }),
        ],
      });
      recipients.push({ studentId: student.id, studentName, status: "sent", remaining });
    } catch (error) {
      recipients.push({
        studentId: student.id,
        studentName,
        status: "failed",
        remaining,
        error: error instanceof Error ? error.message : "LINE send failed",
      });
    }
  }

  return {
    scheduleId: schedule.id,
    kind,
    sent: recipients.filter((recipient) => recipient.status === "sent").length,
    skippedMissingLineId: recipients.filter((recipient) => recipient.status === "missing_line_id").length,
    alreadyPaid: recipients.filter((recipient) => recipient.status === "already_paid").length,
    failed: recipients.filter((recipient) => recipient.status === "failed").length,
    recipients,
  };
}

function buildAnnouncementFlexMessage({
  studentName,
  scheduleName,
  amount,
  startDate,
  dueDate,
  footer,
}: {
  studentName: string;
  scheduleName: string;
  amount: number;
  startDate: string;
  dueDate?: string;
  footer: string;
}): LineMessage {
  return createFlexMessage(`มีกำหนดการใหม่: ${scheduleName}`, [
    flexHero("กำหนดการใหม่", "#2563EB", "#06B6D4"),
    flexText(`เรียน ${studentName}`, "#4B5563", "sm"),
    flexTitle(scheduleName),
    metricGrid([
      metricBox("ยอดที่ต้องชำระ", formatBaht(amount), "#2563EB", "#EFF6FF"),
      metricBox("ครบกำหนด", formatThaiDate(dueDate), "#EA580C", "#FFF7ED"),
    ]),
    flexText(`เริ่ม: ${formatThaiDate(startDate)}`, "#6B7280", "sm"),
    flexText(footer, "#374151", "sm"),
  ]);
}

function buildReminderFlexMessage({
  studentName,
  scheduleName,
  remaining,
  dueDate,
  footer,
}: {
  studentName: string;
  scheduleName: string;
  remaining: number;
  dueDate?: string;
  footer: string;
}): LineMessage {
  return createFlexMessage(`แจ้งเตือนชำระเงิน: ${scheduleName}`, [
    flexHero("แจ้งเตือนชำระเงิน", "#EA580C", "#2563EB"),
    flexText(`เรียน ${studentName}`, "#4B5563", "sm"),
    flexTitle(scheduleName),
    metricGrid([
      metricBox("ยอดค้างชำระ", formatBaht(remaining), "#DC2626", "#FEF2F2"),
      metricBox("ครบกำหนด", formatThaiDate(dueDate), "#EA580C", "#FFF7ED"),
    ]),
    flexText(footer, "#374151", "sm"),
  ]);
}

function createFlexMessage(altText: string, bodyContents: FlexBox[]): LineMessage {
  return {
    type: "flex",
    altText: truncate(altText, 390),
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "18px",
        contents: bodyContents,
      },
    },
  };
}

function flexHero(text: string, from: string, to: string): FlexBox {
  return {
    type: "box",
    layout: "vertical",
    paddingAll: "16px",
    cornerRadius: "20px",
    backgroundColor: from,
    borderWidth: "1px",
    borderColor: to,
    contents: [
      { type: "text", text, weight: "bold", size: "xl", color: "#FFFFFF" },
      { type: "text", text: "ระบบการเงินห้องเรียน", size: "xs", color: "#DBEAFE" },
    ],
  };
}

function flexTitle(text: string): FlexBox {
  return { type: "text", text, weight: "bold", size: "lg", color: "#111827", wrap: true };
}

function flexText(text: string, color: string, size: string): FlexBox {
  return { type: "text", text, color, size, wrap: true };
}

function metricGrid(contents: FlexBox[]): FlexBox {
  return { type: "box", layout: "horizontal", spacing: "sm", contents };
}

function metricBox(label: string, value: string, color: string, backgroundColor: string): FlexBox {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "12px",
    cornerRadius: "16px",
    backgroundColor,
    contents: [
      { type: "text", text: label, size: "xs", color: "#6B7280", wrap: true },
      { type: "text", text: value, size: "md", weight: "bold", color, wrap: true },
    ],
  };
}

function formatBaht(amount: number) {
  return `${amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
}

function formatThaiDate(date: string | undefined) {
  if (!date) return "ยังไม่ระบุ";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function pushLineMessage({ token, to, messages }: { token: string; to: string; messages: LineMessage[] }) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE API ${response.status}${body ? `: ${body}` : ""}`);
  }
}

import "server-only";

import { createRecord, getRecord, getSupabaseAdmin, type Row } from "@/lib/supabase/server";
import { mapLinePaymentRequest, mapTransaction } from "@/lib/supabase/mappers";
import { pushLineText } from "@/lib/server/line";
import { deleteSlipImages } from "@/lib/server/slipStorage";
import { lineMessage } from "@/lib/server/appSettings";

const REVIEWABLE_STATUSES = ["pending_slip_review", "pending_review", "cash_pending"];
const MAX_APPROVED_SLIPS_PER_LINE_USER = 6;

export async function approveLinePaymentRequest({
  requestId,
  reviewerLineUserId,
  notifyStudent = true,
}: {
  requestId: string;
  reviewerLineUserId: string;
  notifyStudent?: boolean;
}) {
  const existingRow = await getRecord<Row>("line_payment_requests", requestId);
  if (!existingRow) throw new Error("Line payment request not found");
  const existing = mapLinePaymentRequest(existingRow);

  if (existing.status === "approved" && existing.transaction_id) {
    const transaction = await getRecord<Row>("transactions", existing.transaction_id);
    await archiveApprovedSlip(existingRow, existing.transaction_id, existing.paid_at || existing.reviewed_at || new Date().toISOString());
    await enforceApprovedSlipRetention(existing.line_user_id).catch((error) => {
      console.error("Failed to enforce approved slip retention", error);
    });
    await deleteCompletedPaymentRequest(existing.id);
    return {
      request: existing,
      transaction: transaction ? mapTransaction(transaction) : null,
    };
  }

  if (!REVIEWABLE_STATUSES.includes(existing.status)) {
    throw new Error("Only pending payment requests can be approved");
  }

  const now = new Date().toISOString();
  const { data: lockedRow, error: lockError } = await getSupabaseAdmin()
    .from("line_payment_requests")
    .update({
      status: "approved",
      slip_status: "approved",
      reviewed_by: reviewerLineUserId,
      reviewed_at: now,
      paid_at: now,
    })
    .eq("id", requestId)
    .in("status", REVIEWABLE_STATUSES)
    .select("*")
    .maybeSingle();

  if (lockError) throw lockError;
  if (!lockedRow) {
    const latest = await getRecord<Row>("line_payment_requests", requestId);
    if (latest) {
      const request = mapLinePaymentRequest(latest);
      if (request.status === "approved" && request.transaction_id) {
        const transaction = await getRecord<Row>("transactions", request.transaction_id);
        return {
          request,
          transaction: transaction ? mapTransaction(transaction) : null,
        };
      }
    }
    throw new Error("Payment request is already being reviewed");
  }

  const paymentRequest = mapLinePaymentRequest(lockedRow);
  const schedule = await getRecord<Row>("schedules", paymentRequest.schedule_id);
  if (!schedule) throw new Error("Schedule not found");

  const method = paymentRequest.method || "cash";
  const transaction = await createRecord<Row>("transactions", {
    name: String(schedule.name),
    kind: "income",
    amount: paymentRequest.amount,
    method,
    category: "การชำระเงินตามกำหนดการ",
    category_id: null,
    description: paymentRequest.slip_url
      ? `LINE payment proof: ${paymentRequest.slip_url}`
      : "LINE cash payment approved",
    source: "schedule",
    schedule_id: paymentRequest.schedule_id,
    student_id: paymentRequest.student_id,
    pocket_id: `pocket-${method}`,
    source_pocket_id: null,
    destination_pocket_id: null,
  });

  const { data: updatedRow, error: updateError } = await getSupabaseAdmin()
    .from("line_payment_requests")
    .update({ transaction_id: transaction.id })
    .eq("id", requestId)
    .select("*")
    .maybeSingle();

  if (updateError) throw updateError;

  const transactionId = String(transaction.id);
  const completedRow = updatedRow || { ...lockedRow, transaction_id: transactionId };
  await archiveApprovedSlip(completedRow, transactionId, now);

  await enforceApprovedSlipRetention(paymentRequest.line_user_id).catch((error) => {
    console.error("Failed to enforce approved slip retention", error);
  });

  await deleteCompletedPaymentRequest(requestId);

  if (notifyStudent) {
    await pushLineText(paymentRequest.line_user_id, await lineMessage("lineApproved"));
  }

  return {
    request: mapLinePaymentRequest(completedRow),
    transaction: mapTransaction(transaction),
  };
}

export async function rejectLinePaymentRequest({
  requestId,
  reviewerLineUserId,
  reason,
}: {
  requestId: string;
  reviewerLineUserId: string;
  reason: string;
}) {
  const cleanReason = reason.trim() || "เหรัญญิกยังไม่สามารถตรวจสอบสลิปนี้ได้";
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("line_payment_requests")
    .update({
      status: "rejected",
      slip_status: "rejected",
      reviewed_by: reviewerLineUserId,
      reviewed_at: now,
      reject_reason: cleanReason,
    })
    .eq("id", requestId)
    .in("status", REVIEWABLE_STATUSES)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Only pending payment requests can be rejected");

  const request = mapLinePaymentRequest(data);
  await pushLineText(request.line_user_id, await lineMessage("lineRejected", { reason: cleanReason }));

  await deleteRejectedSlipImage(request.slip_pathname);
  await deleteCompletedPaymentRequest(request.id);

  return request;
}

async function enforceApprovedSlipRetention(lineUserId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("line_payment_slip_archives")
    .select("id, slip_pathname")
    .eq("line_user_id", lineUserId)
    .not("slip_pathname", "is", null)
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const staleRows = (data || []).slice(MAX_APPROVED_SLIPS_PER_LINE_USER);
  const stalePathnames = staleRows
    .map((row) => typeof row.slip_pathname === "string" ? row.slip_pathname : "")
    .filter(Boolean);
  if (staleRows.length === 0 || stalePathnames.length === 0) return;

  await deleteSlipImages(stalePathnames);

  const staleIds = staleRows.map((row) => String(row.id)).filter(Boolean);
  const { error: updateError } = await getSupabaseAdmin()
    .from("line_payment_slip_archives")
    .update({ slip_url: null, slip_pathname: null })
    .in("id", staleIds);

  if (updateError) throw updateError;
}

async function archiveApprovedSlip(row: Row, transactionId: string, paidAt: string) {
  if (!row.slip_url && !row.slip_pathname && !row.slip_qr_payload && !row.slip_image_hash && !row.slip_transaction_id) {
    return;
  }

  const { error } = await getSupabaseAdmin()
    .from("line_payment_slip_archives")
    .upsert({
      line_user_id: row.line_user_id,
      student_id: row.student_id,
      schedule_id: row.schedule_id,
      transaction_id: transactionId,
      method: row.method ?? null,
      amount: row.amount,
      slip_url: row.slip_url ?? null,
      slip_pathname: row.slip_pathname ?? null,
      slip_qr_payload: row.slip_qr_payload ?? null,
      slip_image_hash: row.slip_image_hash ?? null,
      slip_transaction_id: row.slip_transaction_id ?? null,
      slip_auto_check_result: row.slip_auto_check_result ?? null,
      paid_at: paidAt,
    }, {
      onConflict: "transaction_id",
    });

  if (error) throw error;
}

async function deleteCompletedPaymentRequest(requestId: string) {
  const { error } = await getSupabaseAdmin()
    .from("line_payment_requests")
    .delete()
    .eq("id", requestId);

  if (error) throw error;
}

async function deleteRejectedSlipImage(pathname: string | undefined) {
  if (!pathname) return;

  await deleteSlipImages([pathname]).catch((error) => {
    console.error("Failed to delete rejected slip image", error);
  });
}

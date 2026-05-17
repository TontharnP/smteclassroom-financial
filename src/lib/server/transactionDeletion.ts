import "server-only";

import { deleteSlipImages } from "@/lib/server/slipStorage";
import { getRecord, getSupabaseAdmin, isMissingTableError, type Row } from "@/lib/supabase/server";

type SlipMetadataRow = Pick<Row, "id" | "slip_pathname">;

export async function deleteTransactionWithSlipData(transactionId: string): Promise<boolean> {
  const transaction = await getRecord<Row>("transactions", transactionId);
  if (!transaction) return false;

  const [archivedSlipRows, paymentRequestRows] = await Promise.all([
    listRowsByTransaction("line_payment_slip_archives", transactionId),
    listRowsByTransaction("line_payment_requests", transactionId),
  ]);

  const slipPathnames = uniqueSlipPathnames([...archivedSlipRows, ...paymentRequestRows]);
  await deleteSlipImages(slipPathnames);

  await Promise.all([
    deleteRowsByIds("line_payment_slip_archives", archivedSlipRows.map((row) => row.id)),
    deleteRowsByIds("line_payment_requests", paymentRequestRows.map((row) => row.id)),
  ]);

  const { error } = await getSupabaseAdmin()
    .from("transactions")
    .delete()
    .eq("id", transactionId);

  if (error) throw error;
  return true;
}

async function listRowsByTransaction(table: string, transactionId: string): Promise<SlipMetadataRow[]> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(table)
      .select("id, slip_pathname")
      .eq("transaction_id", transactionId);

    if (error) throw error;
    return (data || []) as SlipMetadataRow[];
  } catch (error) {
    if (isMissingTableError(error, table)) return [];
    throw error;
  }
}

async function deleteRowsByIds(table: string, ids: unknown[]) {
  const cleanIds = ids
    .map((id) => (typeof id === "string" ? id : ""))
    .filter(Boolean);
  if (cleanIds.length === 0) return;

  try {
    const { error } = await getSupabaseAdmin()
      .from(table)
      .delete()
      .in("id", cleanIds);

    if (error) throw error;
  } catch (error) {
    if (isMissingTableError(error, table)) return;
    throw error;
  }
}

function uniqueSlipPathnames(rows: SlipMetadataRow[]) {
  return Array.from(new Set(
    rows
      .map((row) => typeof row.slip_pathname === "string" ? row.slip_pathname.trim() : "")
      .filter(Boolean)
  ));
}

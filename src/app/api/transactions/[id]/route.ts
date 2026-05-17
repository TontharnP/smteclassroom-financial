import { noContent, notFound, ok, serverError } from "@/lib/api/response";
import { deleteTransactionWithSlipData } from "@/lib/server/transactionDeletion";
import { getRecord, updateRecord, type Row } from "@/lib/supabase/server";
import { mapTransaction } from "@/lib/supabase/mappers";
import type { TransactionUpdate } from "@/types/supabase";

type RouteContext = { params: Promise<{ id: string }> };

const transactionColumns = [
  "name",
  "kind",
  "amount",
  "method",
  "category",
  "category_id",
  "description",
  "source",
  "schedule_id",
  "student_id",
  "pocket_id",
  "source_pocket_id",
  "destination_pocket_id",
];

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const row = await getRecord<Row>("transactions", id);
    if (!row) return notFound("Transaction not found");
    return ok(mapTransaction(row));
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as TransactionUpdate;
    const row = await updateRecord<Row>("transactions", id, body, transactionColumns);
    if (!row) return notFound("Transaction not found");
    return ok(mapTransaction(row));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = await deleteTransactionWithSlipData(id);
    if (!deleted) return notFound("Transaction not found");
    return noContent();
  } catch (error) {
    return serverError(error);
  }
}

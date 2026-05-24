import { noContent, notFound, ok, serverError } from "@/lib/api/response";
import { deleteTransactionWithSlipData } from "@/lib/server/transactionDeletion";
import { deleteRecord, getRecord, listRecords, updateRecord, type Row } from "@/lib/supabase/server";
import { mapStudent } from "@/lib/supabase/mappers";
import { linkLineRichMenuByName } from "@/lib/server/line";
import { getRuntimeSettings } from "@/lib/server/appSettings";
import type { StudentUpdate } from "@/types/supabase";

type RouteContext = { params: Promise<{ id: string }> };

const studentColumns = ["prefix", "first_name", "last_name", "nick_name", "number", "avatar_url", "line_user_id"];

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const row = await getRecord<Row>("students", id);
    if (!row) return notFound("Student not found");
    return ok(mapStudent(row));
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as StudentUpdate;
    const previous = await getRecord<Row>("students", id);
    const row = await updateRecord<Row>("students", id, body, studentColumns);
    if (!row) return notFound("Student not found");
    if (body.line_user_id === null && previous?.line_user_id) {
      await linkLineRichMenuByName(String(previous.line_user_id), (await getRuntimeSettings()).lineRegisterRichMenuName);
    }
    return ok(mapStudent(row));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const student = await getRecord<Row>("students", id);
    if (!student) return notFound("Student not found");

    const transactions = await listRecords<Row>("transactions");
    await Promise.all(
      transactions
        .filter((transaction) => transaction.student_id === id)
        .map((transaction) => deleteTransactionWithSlipData(String(transaction.id)))
    );

    await deleteRecord("students", id);
    return noContent();
  } catch (error) {
    return serverError(error);
  }
}

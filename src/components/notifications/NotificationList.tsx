"use client";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "react-hot-toast";
import { useAppStore } from "@/lib/store";
import { Check, X, Banknote, Clock, Wallet } from "lucide-react";
import type { LinePaymentRequest } from "@/types/supabase";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const METHOD_LABELS: Record<string, string> = {
  kplus: "K PLUS",
  cash: "เงินสด",
  truemoney: "TrueMoney",
};

export function NotificationList() {
  const { data: storeData } = useAppStore();
  const { students, schedules } = storeData;
  const { data: requests, error, isLoading, mutate } = useSWR<LinePaymentRequest[]>(
    "/api/line/payment-requests?status=pending_review,pending_slip_review,cash_pending",
    fetcher
  );
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    try {
      setProcessingId(id);
      const res = await fetch(`/api/line/payment-requests/${id}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Approval failed");
      toast.success("อนุมัติรายการสำเร็จ");
      mutate();
    } catch {
      toast.error("เกิดข้อผิดพลาดในการอนุมัติ");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt("เหตุผลที่ปฏิเสธสลิป", "สลิปยังไม่ผ่านการตรวจสอบ");
    if (reason === null) return;
    try {
      setProcessingId(id);
      const res = await fetch(`/api/line/payment-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", reject_reason: reason }),
      });
      if (!res.ok) throw new Error("Rejection failed");
      toast.success("ปฏิเสธรายการสำเร็จ");
      mutate();
    } catch {
      toast.error("เกิดข้อผิดพลาดในการปฏิเสธ");
    } finally {
      setProcessingId(null);
    }
  };

  if (error) return <div className="p-4 text-center text-rose-500">เกิดข้อผิดพลาดในการดึงข้อมูล</div>;
  if (isLoading) return <div className="p-4 text-center text-zinc-500">กำลังโหลดข้อมูล...</div>;
  if (!requests || requests.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-[24px] border border-dashed text-zinc-500" style={{ borderColor: "var(--line)" }}>
        <Check className="mb-2 h-10 w-10 text-emerald-400 opacity-50" />
        <p>ไม่มีรายการรอดำเนินการ</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {requests.map((req) => {
        const student = students.find((s) => s.id === req.student_id);
        const schedule = schedules.find((s) => s.id === req.schedule_id);
        const studentName = student ? `${student.prefix || ""}${student.firstName} ${student.lastName}` : "ไม่พบนักเรียน";
        const scheduleName = schedule?.name || "ไม่พบกำหนดการ";
        const isProcessing = processingId === req.id;
        return (
          <div
            key={req.id}
            className={`apple-card grid min-w-0 overflow-hidden p-0 ${
              req.slip_url ? "lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]" : ""
            }`}
          >
            {req.slip_url && (
              <div className="relative aspect-[3/4] w-full bg-zinc-100 dark:bg-zinc-900 lg:h-full lg:min-h-[420px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={req.slip_url}
                  alt="สลิปการชำระเงิน"
                  className="absolute inset-0 h-full w-full object-contain"
                  loading="lazy"
                />
              </div>
            )}
            
            <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5 lg:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold sm:text-lg lg:text-xl">{studentName}</h3>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="truncate">{scheduleName}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                    {req.amount.toLocaleString()} ฿
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[11px] font-medium text-muted">
                    {req.method === "cash" ? <Banknote className="h-3 w-3" /> : <Wallet className="h-3 w-3" />}
                    {req.method ? METHOD_LABELS[req.method] || req.method : "ไม่ระบุ"}
                  </div>
                </div>
              </div>

              {req.slip_auto_check_result && (
                <div className="rounded-2xl bg-zinc-100 px-3 py-2 text-xs font-medium leading-relaxed text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 sm:text-sm">
                  ผลตรวจอัตโนมัติ: {req.slip_auto_check_result}
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 pt-4">
                <button
                  onClick={() => handleReject(req.id)}
                  disabled={isProcessing}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-100 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-200 disabled:opacity-50 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50"
                >
                  <X className="h-4 w-4" />
                  ปฏิเสธ
                </button>
                <button
                  onClick={() => handleApprove(req.id)}
                  disabled={isProcessing}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                >
                  <Check className="h-4 w-4" />
                  อนุมัติ
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

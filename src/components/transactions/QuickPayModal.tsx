"use client";
import { useMemo, useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/lib/store";
import type { PaymentMethod } from "@/types";
import { createTransaction } from "@/lib/supabase/transactions";
import { dbTransactionToTransaction } from "@/lib/supabase/adapter";
import toast from "react-hot-toast";
import { QRCodeCanvas } from "qrcode.react";
import generatePayload from "promptpay-qr";
import { apiRequest } from "@/lib/api/client";
import { DEFAULT_PUBLIC_SETTINGS, type AppPublicSettings } from "@/lib/settings/schema";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  scheduleId: string;
  studentId: string;
}

export function QuickPayModal({ isOpen, onClose, scheduleId, studentId }: Props) {
  const data = useAppStore((s) => s.data);
  const addTransaction = useAppStore((s) => s.addTransaction);
  const pockets = data.pockets || [];
  // Helper to find pocket by method
  const getPocketIdByMethod = (method: PaymentMethod) => {
    // Robust matching: find pocket with id matching the method
    // e.g. "kplus" -> "pocket-kplus"
    return pockets.find(p => p.id === `pocket-${method}`)?.id || pockets.find(p => p.isDefault)?.id;
  };

  const [rows, setRows] = useState<Array<{ method: PaymentMethod; amount: number }>>([
    { method: "cash", amount: 0 },
  ]);
  const [settings, setSettings] = useState<AppPublicSettings>(DEFAULT_PUBLIC_SETTINGS);

  const schedule = useMemo(() => data.schedules.find((s) => s.id === scheduleId) || null, [data.schedules, scheduleId]);
  const student = useMemo(() => data.students.find((st) => st.id === studentId) || null, [data.students, studentId]);

  // Compute already paid and remaining for this student on this schedule
  const alreadyPaid = data.transactions
    .filter((t) => t.source === "schedule" && t.scheduleId === scheduleId && t.studentId === studentId)
    .reduce((sum, t) => sum + t.amount, 0);
  const remaining = schedule ? Math.max(0, schedule.amountPerItem - alreadyPaid) : 0;

  const totalEntered = rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const remainingAfter = Math.max(0, remaining - totalEntered);
  const canConfirm = remaining > 0 && totalEntered > 0 && totalEntered <= remaining;

  // Auto-fill logic when modal opens or student changes
  useEffect(() => {
    if (isOpen && remaining > 0) {
      queueMicrotask(() => {
        setRows((currentRows) => {
          if (currentRows.length === 1 && currentRows[0].amount === 0) {
            return [{ method: "cash", amount: remaining }];
          }
          return currentRows;
        });
      });
    }
  }, [isOpen, remaining]);

  useEffect(() => {
    if (!isOpen) return;
    let ignore = false;
    apiRequest<AppPublicSettings>("/api/settings")
      .then((payload) => {
        if (!ignore) setSettings(payload);
      })
      .catch(() => {
        if (!ignore) setSettings(DEFAULT_PUBLIC_SETTINGS);
      });
    return () => {
      ignore = true;
    };
  }, [isOpen]);

  if (!schedule || !student) return null;

  const handleConfirm = async () => {
    if (remaining === 0) {
      toast("นักเรียนคนนี้ชำระครบแล้ว");
      onClose();
      return;
    }
    if (totalEntered <= 0) {
      toast.error("กรุณากรอกจำนวนเงิน");
      return;
    }
    if (totalEntered > remaining) {
      toast.error("ยอดที่กรอกมากกว่ายอดคงเหลือ");
      return;
    }

    try {
      // Create one database transaction per selected row
      for (const r of rows) {
        if (!r.amount) continue;
        const targetPocketId = getPocketIdByMethod(r.method);
        const created = await createTransaction({
          name: schedule.name,
          kind: "income",
          amount: r.amount,
          method: r.method,
          category: "การชำระเงินตามกำหนดการ",
          description: undefined,
          source: "schedule",
          schedule_id: scheduleId,
          student_id: studentId,
          pocket_id: targetPocketId,
        });
        addTransaction(dbTransactionToTransaction(created));
      }
      if (remainingAfter > 0) {
        toast.success(`บันทึกแล้ว ค้างอีก ${remainingAfter.toLocaleString()} ฿`);
      } else {
        toast.success("ชำระครบเรียบร้อย");
      }
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("เกิดข้อผิดพลาดในการบันทึก");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="ชำระเงิน (ด่วน)">
      <div className="space-y-4">
        <div className="apple-soft rounded-[20px] p-3">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">กำหนดการ</div>
          <div className="font-semibold">{schedule.name}</div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">ผู้ชำระ: {student.firstName} ({student.nickName})</div>
          <div className="mt-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">{schedule.amountPerItem.toLocaleString()} ฿</div>
          <div className="mt-1 text-sm">
            ชำระแล้ว: <span className="font-medium text-blue-600 dark:text-blue-400">{alreadyPaid.toLocaleString()}</span> ฿
            <span className="mx-1">•</span>
            คงเหลือ: <span className="font-medium text-rose-600 dark:text-rose-400">{remaining.toLocaleString()}</span> ฿
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">แบ่งการชำระ (รวมต้องเท่ากับ {remaining.toLocaleString()} ฿)</label>
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, { method: "cash", amount: 0 }])}
              className="apple-ghost-button px-3 py-1 text-sm"
            >
              เพิ่มช่อง
            </button>
          </div>
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2">
              <select
                value={row.method}
                onChange={(e) => {
                  const method = e.target.value as PaymentMethod;
                  setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, method } : r)));
                }}
                className="col-span-12 rounded-full border px-3 py-2 sm:col-span-5"
              >
                <option value="kplus">K PLUS</option>
                <option value="cash">เงินสด</option>
                <option value="truemoney">TrueMoney</option>
              </select>
              <input
                type="number"
                min={0}
                step={1}
                value={row.amount}
                onChange={(e) => {
                  const amount = Number(e.target.value || 0);
                  setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, amount } : r)));
                }}
                className="col-span-10 rounded-full border px-3 py-2 sm:col-span-6"
                placeholder="จำนวนเงิน"
              />
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                className="apple-ghost-button col-span-2 rounded-full px-2 py-2 text-xs sm:col-span-1"
                aria-label="ลบแถว"
              >
                ลบ
              </button>

              {/* QR Code for K PLUS */}
              {row.method === "kplus" && row.amount > 0 && (
                <div className="apple-soft col-span-12 my-2 flex flex-col items-center justify-center rounded-[20px] bg-white p-4">
                  <QRCodeCanvas
                    value={generatePayload(settings.promptPayId || DEFAULT_PUBLIC_SETTINGS.promptPayId, { amount: row.amount })}
                    size={200}
                    level={"L"}
                    includeMargin={true}
                  />
                  <div className="mt-2 font-semibold text-emerald-600">สแกนจ่าย {row.amount.toLocaleString()} ฿</div>
                  <div className="text-xs text-zinc-400">PromptPay: {settings.promptPayId || DEFAULT_PUBLIC_SETTINGS.promptPayId}</div>
                </div>
              )}
            </div>
          ))}
          <div className="text-right text-sm text-zinc-600 dark:text-zinc-400 space-y-0.5">
            <div>
              รวมที่กรอก: <span className={totalEntered > 0 && totalEntered <= remaining ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-rose-600 dark:text-rose-400 font-medium"}>{totalEntered.toLocaleString()}</span> ฿
            </div>
            {totalEntered > 0 && totalEntered < remaining && (
              <div className="text-xs text-amber-600 dark:text-amber-400">ค้างอีก {remainingAfter.toLocaleString()} ฿</div>
            )}
            {totalEntered > remaining && (
              <div className="text-xs text-red-600">เกิน {Math.round((totalEntered - remaining) * 100) / 100} ฿</div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="apple-ghost-button flex-1 px-4 py-2">ยกเลิก</button>
          <button onClick={handleConfirm} disabled={!canConfirm} className="apple-button flex-1 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-40">ยืนยันชำระ</button>
        </div>
      </div>
    </Modal>
  );
}

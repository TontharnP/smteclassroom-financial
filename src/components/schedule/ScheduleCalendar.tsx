"use client";
import { useState } from "react";
import Calendar from "react-calendar";
import type { Value } from "react-calendar/dist/shared/types.js";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3 } from "lucide-react";
import { format, isBefore, isSameDay, parseISO, startOfDay } from "date-fns";
import { useAppStore } from "@/lib/store";
import { getSchedulesInSystemOrder } from "@/lib/schedules/grouping";
import { countStudentPaymentStatus } from "@/lib/calculations";
import type { Schedule } from "@/types";

type ScheduleCalendarProps = {
  onScheduleClick: (schedule: Schedule) => void;
};

export function ScheduleCalendar({ onScheduleClick }: ScheduleCalendarProps) {
  const data = useAppStore((state) => state.data);
  const orderedSchedules = getSchedulesInSystemOrder(data);
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const today = startOfDay(new Date());

  const getSchedulesForDate = (date: Date | null) => {
    if (!date) return [];
    const day = startOfDay(date);
    return orderedSchedules.filter((schedule) => {
      const startDate = parseISO(schedule.startDate);
      const endDate = schedule.endDate ? parseISO(schedule.endDate) : null;

      if (endDate) {
        return day >= startOfDay(startDate) && day <= startOfDay(endDate);
      }
      return isSameDay(startDate, day);
    });
  };

  const schedulesOnDate = getSchedulesForDate(selectedDate);

  const scheduleStatus = new Map(
    orderedSchedules.map((schedule) => {
      const payment = countStudentPaymentStatus(data, schedule.id);
      const target = schedule.amountPerItem * schedule.studentIds.length;
      const collected = data.transactions
        .filter((transaction) => transaction.source === "schedule" && transaction.scheduleId === schedule.id)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const remaining = Math.max(0, target - collected);
      const dueDate = schedule.endDate ? startOfDay(parseISO(schedule.endDate)) : startOfDay(parseISO(schedule.startDate));
      const isOverdue = remaining > 0 && isBefore(dueDate, today);
      return [schedule.id, { ...payment, target, collected, remaining, dueDate, isOverdue }];
    })
  );

  const upcomingSchedules = orderedSchedules
    .filter((schedule) => {
      const status = scheduleStatus.get(schedule.id);
      if (!status || status.remaining <= 0 || status.isOverdue) return false;
      const days = Math.ceil((status.dueDate.getTime() - today.getTime()) / 86_400_000);
      return days <= 14;
    })
    .sort((a, b) => {
      const aDate = scheduleStatus.get(a.id)?.dueDate.getTime() || 0;
      const bDate = scheduleStatus.get(b.id)?.dueDate.getTime() || 0;
      return aDate - bDate;
    })
    .slice(0, 5);

  const overdueSchedules = orderedSchedules
    .filter((schedule) => scheduleStatus.get(schedule.id)?.isOverdue)
    .sort((a, b) => {
      const aDate = scheduleStatus.get(a.id)?.dueDate.getTime() || 0;
      const bDate = scheduleStatus.get(b.id)?.dueDate.getTime() || 0;
      return aDate - bDate;
    })
    .slice(0, 5);

  const hasScheduleOnDate = (date: Date) => getSchedulesForDate(date).length > 0;

  const handleDateChange = (value: Value) => {
    const date = Array.isArray(value) ? value[0] : value;
    setSelectedDate(date);
  };

  return (
    <div className="grid min-h-0 gap-4">
      <div className="calendar-wrapper mx-auto w-full max-w-xl min-w-0">
        <Calendar
          onChange={handleDateChange}
          value={selectedDate}
          locale="th-TH"
          prev2Label={null}
          next2Label={null}
          tileClassName={({ date }) =>
            hasScheduleOnDate(date) ? "react-calendar__tile--hasSchedule" : ""
          }
          tileContent={({ date, view }) => {
            if (view !== "month") return null;
            const daySchedules = getSchedulesForDate(date);
            if (daySchedules.length === 0) return null;
            const overdueCount = daySchedules.filter((schedule) => scheduleStatus.get(schedule.id)?.isOverdue).length;
            const completeCount = daySchedules.filter((schedule) => scheduleStatus.get(schedule.id)?.remaining === 0).length;

            return (
              <div className="mt-1 flex items-center justify-center gap-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {overdueCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                {completeCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
              </div>
            );
          }}
        />
      </div>

      <div className="min-h-0 space-y-3">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)", background: "var(--panel-soft)" }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-blue-600" />
            {selectedDate ? format(selectedDate, "dd/MM/yyyy") : "เลือกวันที่"}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedDate?.toISOString() || "empty"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="max-h-64 space-y-2 overflow-y-auto pr-1"
            >
              {schedulesOnDate.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted" style={{ borderColor: "var(--line)" }}>
                  วันนี้ไม่มีกำหนดการ
                </div>
              ) : (
                schedulesOnDate.map((schedule) => (
                  <ScheduleAgendaItem
                    key={schedule.id}
                    schedule={schedule}
                    status={scheduleStatus.get(schedule.id)}
                    onClick={() => onScheduleClick(schedule)}
                  />
                ))
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="grid gap-3 2xl:grid-cols-2">
          <ScheduleStatusPanel
            title="ใกล้ครบกำหนด"
            icon={<Clock3 className="h-4 w-4 text-amber-600" />}
            schedules={upcomingSchedules}
            scheduleStatus={scheduleStatus}
            emptyText="ยังไม่มีกำหนดการใกล้ครบกำหนด"
            onScheduleClick={onScheduleClick}
          />

          <ScheduleStatusPanel
            title="เลยกำหนด"
            icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
            schedules={overdueSchedules}
            scheduleStatus={scheduleStatus}
            emptyText="ไม่มีรายการเลยกำหนด"
            onScheduleClick={onScheduleClick}
          />
        </div>
      </div>
    </div>
  );
}

type StatusValue = {
  paid: number;
  unpaid: number;
  target: number;
  collected: number;
  remaining: number;
  dueDate: Date;
  isOverdue: boolean;
};

function ScheduleAgendaItem({
  schedule,
  status,
  onClick,
}: {
  schedule: Schedule;
  status?: StatusValue;
  onClick: () => void;
}) {
  const percent = status && status.target > 0 ? Math.min(100, Math.round((status.collected / status.target) * 100)) : 0;

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/70 dark:hover:bg-blue-950/20"
      style={{ borderColor: "var(--line)", background: "var(--panel)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{schedule.name}</div>
          <div className="mt-0.5 text-xs text-muted">
            {schedule.amountPerItem.toLocaleString()} ฿/คน • {schedule.studentIds.length} คน
          </div>
        </div>
        {status?.remaining === 0 ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status?.isOverdue ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700"}`}>
            {status?.unpaid ?? 0} ค้าง
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1 text-xs text-muted">
        เก็บได้ {status?.collected.toLocaleString() ?? 0} / {status?.target.toLocaleString() ?? 0} ฿
      </div>
    </button>
  );
}

function ScheduleStatusPanel({
  title,
  icon,
  schedules,
  scheduleStatus,
  emptyText,
  onScheduleClick,
}: {
  title: string;
  icon: React.ReactNode;
  schedules: Schedule[];
  scheduleStatus: Map<string, StatusValue>;
  emptyText: string;
  onScheduleClick: (schedule: Schedule) => void;
}) {
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)", background: "var(--panel-soft)" }}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="space-y-2">
        {schedules.length === 0 ? (
          <div className="rounded-xl border border-dashed p-3 text-center text-xs text-muted" style={{ borderColor: "var(--line)" }}>
            {emptyText}
          </div>
        ) : (
          schedules.map((schedule) => (
          <motion.div
              key={schedule.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
          >
              <ScheduleAgendaItem schedule={schedule} status={scheduleStatus.get(schedule.id)} onClick={() => onScheduleClick(schedule)} />
          </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { NotificationList } from "@/components/notifications/NotificationList";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function NotificationsPage() {
  return (
    <div className="fixed-page">
      <div className="fixed-page-header flex flex-col gap-1">
        <h1 className="section-title text-2xl sm:text-3xl md:text-4xl">การแจ้งเตือน</h1>
        <p className="page-kicker">ตรวจสอบและอนุมัติรายการชำระเงินที่รอการยืนยัน</p>
      </div>
      <div className="fixed-page-body">
        <ErrorBoundary>
          <Suspense fallback={<div className="p-4 text-center text-sm text-zinc-500">กำลังโหลด...</div>}>
            <NotificationList />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

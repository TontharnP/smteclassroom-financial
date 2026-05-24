import { SettingsPanel } from "@/components/settings/SettingsPanel";

export default function SettingsPage() {
  return (
    <div className="fixed-page">
      <div className="fixed-page-header flex flex-col gap-1">
        <p className="page-kicker">System settings</p>
        <h1 className="section-title text-2xl sm:text-3xl md:text-4xl">ตั้งค่าระบบ</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          แก้ค่าระบบจากเว็บสำหรับเวอร์ชันส่งต่อรุ่นน้อง รวมถึง LINE, EasySlip, QR, receiver, slip checker และข้อความ LINE
        </p>
      </div>
      
      <div className="fixed-page-body">
        <SettingsPanel />
      </div>
    </div>
  );
}

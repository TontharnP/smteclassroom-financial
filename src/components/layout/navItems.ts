import { Bell, CalendarDays, ChartNoAxesCombined, FolderKanban, ReceiptText, Settings, UsersRound } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "ภาพรวม", shortLabel: "ภาพรวม", icon: ChartNoAxesCombined },
  { href: "/transactions", label: "รายการเงิน", shortLabel: "รายการ", icon: ReceiptText },
  { href: "/schedule", label: "กำหนดการ", shortLabel: "กำหนด", icon: CalendarDays },
  { href: "/categories", label: "หมวดหมู่", shortLabel: "หมวด", icon: FolderKanban },
  { href: "/students", label: "นักเรียน", shortLabel: "นักเรียน", icon: UsersRound },
  { href: "/notifications", label: "การแจ้งเตือน", shortLabel: "แจ้งเตือน", icon: Bell },
  { href: "/settings", label: "ตั้งค่า", shortLabel: "ตั้งค่า", icon: Settings },
] as const;

export type NavItem = typeof NAV_ITEMS[number];

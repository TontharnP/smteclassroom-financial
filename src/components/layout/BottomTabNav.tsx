"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navItems";

export default function BottomTabNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-2 left-2 right-2 z-40 glass-nav rounded-[22px] border md:hidden safe-bottom min-[390px]:left-3 min-[390px]:right-3">
      <ul
        className="mx-auto grid max-w-screen-sm gap-0.5 px-1 py-1 min-[390px]:gap-1 min-[390px]:px-1.5"
        style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))` }}
      >
        {NAV_ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex justify-center">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`nav-item ${active ? "nav-item-active" : ""} pressable flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 py-1 text-[9px] font-semibold leading-tight min-[390px]:min-h-[52px] min-[390px]:px-1 min-[390px]:text-[10px]`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0 min-[390px]:h-5 min-[390px]:w-5" />
                <span className="block max-w-full truncate">{item.shortLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

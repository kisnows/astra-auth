"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityLogIcon,
  DashboardIcon,
  GlobeIcon,
  IdCardIcon,
  PersonIcon,
} from "@radix-ui/react-icons";

const navItems = [
  { href: "/admin", label: "控制台", icon: DashboardIcon },
  { href: "/admin/clients", label: "应用接入", icon: IdCardIcon },
  { href: "/admin/providers", label: "第三方登录", icon: GlobeIcon },
  { href: "/admin/users", label: "用户管理", icon: PersonIcon },
  { href: "/admin/audits", label: "审计日志", icon: ActivityLogIcon },
];

/** 中文注释：按最精确路径匹配当前栏目，避免控制台首页在所有子路由上保持高亮。 */
function isCurrentPath(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="管理导航">
      {navItems.map((item) => {
        const active = isCurrentPath(pathname, item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className="admin-nav-link"
            aria-current={active ? "page" : undefined}
          >
            <Icon className="admin-nav-icon" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

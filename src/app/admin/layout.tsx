import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { ThemeSwitcher } from "../theme-switcher";
import { AdminNavigation } from "./admin-navigation";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-top">
          <Link href="/admin" className="admin-brand" aria-label="返回认证控制台">
            <span className="admin-brand-mark" aria-hidden="true">
              <span />
            </span>
            <span>
              <strong>AstraOS</strong>
              <small>IDENTITY CONTROL</small>
            </span>
          </Link>
          <AdminNavigation />
        </div>

        <div className="admin-sidebar-footer">
          <div className="admin-instance-status">
            <LockClosedIcon aria-hidden="true" />
            <span>
              <strong>认证管理控制台</strong>
              <small>受保护区域</small>
            </span>
          </div>
          <div className="admin-sidebar-tools">
            <ThemeSwitcher variant="admin" />
            <Link href="/account" className="admin-account-link">
              <ArrowLeftIcon aria-hidden="true" />
              账户中心
            </Link>
          </div>
        </div>
      </aside>
      <section className="admin-content">
        <div className="admin-content-inner">{children}</div>
      </section>
    </div>
  );
}

import "./globals.css";
import "./admin/admin.css";
import "./admin/admin-dashboard.css";
import "./admin/admin-responsive.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { ThemeSwitcher } from "./theme-switcher";

export const metadata = {
  title: "AstraOS Auth",
  description: "AstraOS 统一登录服务",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" data-theme="system" suppressHydrationWarning>
      <head>
        {/* 中文注释：在页面绘制前恢复用户偏好，避免主题闪烁。 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body><ThemeSwitcher />{children}</body>
    </html>
  );
}

"use client";

import { useEffect, useState } from "react";
import { DesktopIcon, MoonIcon, SunIcon } from "@radix-ui/react-icons";
import { normalizeThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

type ThemeSwitcherProps = {
  variant?: "toolbar" | "admin";
};

/** 中文注释：外观偏好只在当前浏览器保存；系统主题变化由 CSS 响应，不覆盖用户显式选择。 */
export function ThemeSwitcher({ variant = "toolbar" }: ThemeSwitcherProps) {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPreference(normalizeThemePreference(document.documentElement.dataset.theme));
    setReady(true);
    // 中文注释：同源标签页修改或清空偏好后同步外观，监听器随组件卸载移除。
    function sync(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const next = normalizeThemePreference(event.newValue);
      document.documentElement.dataset.theme = next;
      setPreference(next);
    }
    // 中文注释：同页的管理端与全局控件通过自定义事件同步，避免客户端导航后显示旧值。
    function syncCurrentPage(event: Event) {
      const next = normalizeThemePreference(
        event instanceof CustomEvent
          ? event.detail
          : document.documentElement.dataset.theme,
      );
      setPreference(next);
    }
    window.addEventListener("storage", sync);
    window.addEventListener("astra-theme-change", syncCurrentPage);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("astra-theme-change", syncCurrentPage);
    };
  }, []);

  /** 中文注释：先更新当前页面，再尝试持久化，浏览器禁用存储时仍可手动切换。 */
  function change(value: string) {
    const next = normalizeThemePreference(value);
    document.documentElement.dataset.theme = next;
    setPreference(next);
    window.dispatchEvent(new CustomEvent("astra-theme-change", { detail: next }));
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch { /* 中文注释：隐私模式限制存储时保留当前页面的选择。 */ }
  }

  if (variant === "admin") {
    const options = [
      { value: "system" as const, label: "跟随系统", icon: DesktopIcon },
      { value: "light" as const, label: "浅色", icon: SunIcon },
      { value: "dark" as const, label: "深色", icon: MoonIcon },
    ];

    return (
      <div className="admin-theme-switcher" aria-label="外观主题">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={preference === option.value}
              disabled={!ready}
              onClick={() => change(option.value)}
            >
              <Icon aria-hidden="true" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="theme-toolbar">
      <label className="theme-control" htmlFor="auth-theme">
        外观
        <select
          id="auth-theme"
          value={preference}
          disabled={!ready}
          onChange={(event) => change(event.target.value)}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
    </div>
  );
}

export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "astraos-auth.theme.v1";

/** 中文注释：只接受已知偏好，旧值或无效存储统一回到跟随系统。 */
export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** 中文注释：在首屏绘制前应用偏好；静态脚本不插入任何用户内容，存储失败由 CSS 跟随系统。 */
export const THEME_INIT_SCRIPT = `(function(){try{var value=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.dataset.theme=value==='light'||value==='dark'?value:'system';}catch(e){document.documentElement.dataset.theme='system';}})();`;

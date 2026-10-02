import { z } from "zod";

/** 中文注释：回调必须是精确 HTTPS 地址；仅本机开发允许 HTTP。 */
function validRedirect(value: string) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !value.includes("*") && !value.includes(",") &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}

export const clientInputSchema = z.object({
  appName: z.string().trim().min(1).max(100),
  loginDescription: z.string().trim().max(500).nullable().optional(),
  redirectUris: z.string().max(8000).transform((raw) => [...new Set(raw.split("\n").map((v) => v.trim()).filter(Boolean))])
    .refine((uris) => uris.length > 0 && uris.length <= 20 && uris.every(validRedirect), "invalid_redirect_uris"),
  scopes: z.string().trim().min(1).max(1000).default("openid profile email"),
  trusted: z.boolean().default(true),
  allowedUserIds: z.array(z.string().min(1).max(200)).max(1000).nullable().default([]),
  status: z.enum(["active", "disabled"]).default("active"),
});

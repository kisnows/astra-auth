import { describe, expect, it } from "vitest";
import { resolveAuthRedirect } from "@/lib/auth-redirect";

const options = { currentOrigin: "https://auth.example.com/", redirectAllowlist: ["https://stock.example.com"] };

describe("账户首页与业务回跳", () => {
  it.each([undefined, null, "", "/", "/?source=login", "/sign-in", "/signin/", "/sign-up?x=1", "https://auth.example.com/sign-in"])("直接登录或循环目标回到账户首页：%s", (raw) => {
    expect(resolveAuthRedirect({ ...options, raw })).toBe("/account");
  });
  it.each(["//evil.example", "/\\evil.example", "/\nevil", "https://evil.example", "javascript:alert(1)", "https://owner@auth.example.com/", "somewhere", ["/account", "//evil.example"]])("拒绝不安全或重复参数回调：%s", (raw) => {
    expect(resolveAuthRedirect({ ...options, raw })).toBe("/account");
  });
  it("保留 OIDC 授权和已登记应用的回跳地址", () => {
    for (const raw of ["/oauth2/authorize?client_id=stock&state=original", "/admin/clients", "https://stock.example.com/api/auth/callback?code=code&state=state"]) {
      expect(resolveAuthRedirect({ ...options, raw })).toBe(raw);
    }
  });
});

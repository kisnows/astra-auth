import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginApplicationHeader } from "@/app/login-application-header";

describe("应用登录展示", () => {
  it("两种应用展示各自介绍，直接登录保持认证中心信息", () => {
    for (const [appName, description] of [["Media Vault", "浏览与管理授权媒体"], ["Life Finance", "记录收支，了解家庭财务"]]) {
      const html = renderToStaticMarkup(React.createElement(LoginApplicationHeader, { application: { appName, description, origin: "https://app.example:20777" } }));
      expect(html).toContain(appName); expect(html).toContain(description); expect(html).toContain("AstraOS 统一账号"); expect(html).toContain("https://app.example:20777");
    }
    expect(renderToStaticMarkup(React.createElement(LoginApplicationHeader))).toContain("AstraOS 登录");
  });
  it("自定义文案按文本转义，注册页保持来源介绍", () => {
    const html = renderToStaticMarkup(React.createElement(LoginApplicationHeader, { signup: true, application: { appName: "<img src=x onerror=alert(1)>", description: "<script>alert(1)</script>", origin: "https://app.example" } }));
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("注册并前往");
  });
});

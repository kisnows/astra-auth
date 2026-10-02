import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 中文注释：回归构建使用独立目录，不覆盖正在运行的开发构建。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  // 中文注释：独立仓库明确追踪根目录，避免上层其他项目的锁文件改变产物布局。
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  // 中文注释：持久化数据和服务端密钥仅在运行时挂载，不进入独立构建产物。
  outputFileTracingExcludes: {
    "/*": ["./infra/db/**/*", "./data/**/*", "./secrets/**/*", "./.env*", "./**/oidc-signing-key.json"],
  },
  // 中文注释：原生依赖在 Next 16 Turbopack 下需走服务端 external，避免构建期 route 收集失败。
  serverExternalPackages: ["better-sqlite3"],
  // Docker 部署使用 standalone 模式，生成独立运行目录
  output: "standalone",
};

export default nextConfig;

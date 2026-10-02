# Astra Auth

独立维护的统一认证中心，提供邮箱密码登录、GitHub/Google 登录注册、账号绑定、OIDC/OAuth2、应用接入管理与认证审计。

基于 Next.js 16、React 19、Drizzle 与 SQLite。来自 AstraOS 的 Auth 模块，保留既有身份和数据库兼容契约。

## 本地开发

使用 Node.js 22.22.1 与 pnpm 9.12.0。

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

分别生成并配置 AUTH_SECRET 与 INTERNAL_AUTH_SECRET，设置自己的 AUTH_BOOTSTRAP_ADMIN_EMAIL 后运行：

```sh
pnpm dev
```

打开 http://localhost:4300。使用配置的邮箱注册并登录，可通过首个管理员流程进入管理后台。模板关闭演示账号、测试账号与本地 OAuth 客户端。代码中的演示密码和测试凭据仅用于显式启用的本地 fixture。

## 校验和运行

```sh
pnpm check                # lint、认证测试、迁移测试与生产构建
pnpm start               # 启动构建结果；先配置运行环境
pnpm hash:password       # 密码哈希辅助工具
```

脚本完整清单见 package.json。开发 bootstrap 默认写入 infra/db/auth.sqlite；测试使用独立临时数据库。scripts/migrate-auth.ts 是历史数据导入工具，仅在明确的迁移方案中手动使用，必须显式指定来源数据库。

## Docker

Dockerfile 构建独立运行镜像。准备被 Git 忽略的 .env.production，设置真实 HTTPS issuer、随机密钥、生产管理员邮箱及可信来源；所有 AUTH_BOOTSTRAP_* 演示注入开关保持关闭。

```sh
docker compose -f docker-compose.auth.yml build
docker compose -f docker-compose.auth.yml up -d
```

Compose 默认只在宿主机回环地址 33000 端口提供服务，由你自己的 HTTPS 代理接入。数据目录通过 AUTH_DATA_DIR 指定，容器用户 UID/GID 为 1001，目录需可写。上游配置文件另行只读挂载并设置 AUTH_UPSTREAM_PROVIDERS_FILE。

已有实例切换时必须使用原有数据目录、issuer、签名密钥和客户端配置。仓库创建不会自动替换现有生产实例。

## 协议与文档

- [认证、数据与发布契约](docs/auth-contract.md)
- [第三方登录配置](docs/upstream-login.md)
- [第三方配置模板](docs/upstream-providers.example.json)
- [提取来源与兼容说明](docs/extraction.md)
- [发布内容检查](docs/publication-review.md)

标准端点：/.well-known/openid-configuration、/oauth2/authorize、/oauth2/token、/oauth2/userinfo、/jwks。
用户中心位于 /account，应用接入和用户管理位于 /admin。新应用在管理台注册独立客户端并明确授权用户。

## 许可

沿用来源仓库的 Unlicense，详见 LICENSE。

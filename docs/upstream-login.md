# 第三方账号登录

Auth 可作为 GitHub / Google / 微信开放平台网站应用 / 通用 OIDC 的登录入口。业务应用继续信任 Auth，第三方账号绑定不会改变 User.id、邮箱、角色或应用访问白名单。

## 配置

1. 复制 `upstream-providers.example.json` 到 Git 之外的持久目录（例如容器内 `/app/data/upstream-providers.json`），设置文件权限 0600。
2. 在 Auth 的服务器环境文件设置 `AUTH_UPSTREAM_PROVIDERS_FILE=/app/data/upstream-providers.json`，保留现有 `AUTH_SECRET`（至少 32 字符），重建 Auth 容器使新增环境变量生效。不要将真实应用密钥写入 Git、命令日志、工单或浏览器。
3. 修改对应配置的 clientId / clientSecret，设置 enabled 为 true。Google 固定使用 accounts.google.com；OIDC 配置 provider issuer（须精确匹配 discovery 的 issuer），tokenAuthMethod 可为 client_secret_post（默认）或 client_secret_basic。
4. 打开 `/admin/providers` 检查状态，将完整回调地址登记到平台。配置文件每次请求重新读取；凭据轮换后新流程会使用新配置。

示例回调：

- GitHub：`https://auth.example.com/api/federation/github/callback`
- Google：`https://auth.example.com/api/federation/google/callback`
- 微信：`https://auth.example.com/api/federation/wechat/callback`
- OIDC：`https://auth.example.com/api/federation/oidc/callback`

GitHub 使用 OAuth App，授权范围为 `read:user user:email`，从 `/user/emails` 获取已验证邮箱（优先主邮箱）；Google 使用 Web application OAuth client，需完成 consent screen 与测试用户配置。微信使用审核通过的开放平台网站应用，scope 为 snsapi_login，不是公众号网页授权或小程序登录。微信平台对回调域名、端口和主体资质的限制以应用控制台为准；若不接受当前 :20777，需要先提供可用的标准 HTTPS 入口。

配置 id、type、clientId、issuer 构成身份命名空间的一部分：修改后不会继承旧绑定，用户必须重新绑定。仅修改 name 或轮换 clientSecret 不影响绑定。不同 OIDC 提供方可增加多个具有独立 id 的配置对象。禁用源立即阻止其新登录，现有 Auth 会话保持原有效期；紧急封禁用户应在用户管理中禁用该账号。

## 用户操作

1. 在登录页或注册页选择 GitHub / Google；首次授权用平台已验证邮箱自动创建普通 Auth 账号并登录，再次授权进入原账号，无需先设置密码。没有已验证邮箱时先在平台验证，或用邮箱注册后绑定。
2. 若提示邮箱已注册，使用原登录方式进入 `/account` 后主动绑定。相同邮箱不会自动合并账号；平台邮箱或昵称变化不会覆盖已有账号资料。
3. 已有密码的用户，绑定/解绑仍验证当前密码。没有密码的用户，使用已绑定且启用的平台重新验证身份；验证后确认绑定或解绑。重新验证选错平台账号、会话变化、证明超时或重放均拒绝操作。
4. 无密码用户可在账户中心「设置密码」，完成第三方重新验证后设置至少 8 位的密码，今后也可用邮箱密码登录。平台全部停用或账号无法找回时使用管理员密码恢复流程。
5. 解绑不删除用户或业务数据，且必须保留一个可用登录方式：本地密码或另一个已启用的第三方身份。停用或配置已被替换的绑定不能作为备用登录方式。

微信网站扫码和通用 OIDC 暂维持先登录已有 Auth 账号再绑定的流程。上游登录与新账号注册均不授予管理员角色或业务应用白名单，已有业务账号仍需在业务应用验证后绑定。

## 验收与安全

- state、PKCE、nonce、签名、issuer/aud 由服务端验证（微信无 PKCE，使用一次性 code + state）；state 加密落在已有 AuthVerification 表，十分钟过期，原子消费防重放。
- 绑定与解绑需要当前密码或无密码账号的近期上游验证证明，以及同源 POST；重新验证证明使用 host-only HttpOnly Cookie、当前会话绑定、五分钟有效期和原子消费。回调拒绝会话切换、身份抢绑、禁用用户、未完成强制改密用户。
- 上游 token 仅在当前请求内使用，不写入 AuthAccount，不返回浏览器或日志。
- 测试使用隔离 SQLite 和本地 OIDC fixture；真实平台联调仍需上述有效凭据，不能以 mock 通过宣称实际平台登录已验证。
- 本功能复用已有表，不修改 schema。发布前备份数据库和环境配置；回滚到之前镜像保留扩展身份行，密码和既有 OIDC 客户端继续可用。

## 账号契约

身份、无密码账号管理和数据兼容约束见 [认证契约](auth-contract.md)。

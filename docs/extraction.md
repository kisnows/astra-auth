# Auth 独立仓库提取

- 日期：2026-10-02。
- 来源：kisnows/AstraOS 的 apps/auth 当前工作区，包含 GitHub/Google 注册及无密码账号管理改动。
- 来源 checkout HEAD：48e179ecce832aab42e8e7aa1e260c7019ebcee1。
- 对照远程 master：a253b08096231b3d5276d650a6faebef9141948d。
- 使用干净的初始提交，不复制原仓库 Git 历史、环境变量、真实数据、签名文件或运行产物。
- 提取 Auth 实际使用的共享内部签名代码到 src/server/internal-service-signature.ts；签名算法及协议不变。
- 新仓库使用根目录 Next.js 布局，单独维护锁文件、测试、Dockerfile 与 CI。
- 依赖版本从来源锁文件继承；旧共享包依赖已移除。
- 旧仓库的源码与部署保留，后续运行版本切换按 auth-contract.md 单独验收。
- Windows 开发测试按平台处理 POSIX mode 检查；Linux CI 继续验证签名文件为 0600。
- Cookie 解析测试中预期值 abc123 的固定夹具被扫描器误识别，已逐行标注；没有放行整个测试目录。

import { hash } from "bcryptjs";

const raw = process.argv[2];

if (!raw) {
  console.error("Usage: node scripts/hash-password.mjs <plain-password>");
  process.exit(1);
}

/** 中文注释：用于部署前生成管理员初始密码哈希，避免明文密码入库或写入镜像。 */
const digest = await hash(raw, 12);
console.log(digest);

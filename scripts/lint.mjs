import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

// 中文注释：跨平台启动原有 ESLint 规则，不依赖 Unix 环境变量赋值语法。
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve("eslint/package.json")), "bin/eslint.js"), ".", "--ext", ".ts,.tsx,.mjs,.cjs", "--max-warnings=0"], {
  stdio: "inherit", env: { ...process.env, ESLINT_USE_FLAT_CONFIG: "false" },
});
process.exit(result.status ?? 1);

declare global {
  // eslint-disable-next-line no-var
  var __authStartupEnvLogged: boolean | undefined;
}

/**
 * 中文注释：auth 启动时按白名单输出环境变量，帮助定位部署配置是否生效。
 */
function logAuthStartupEnvOnce() {
  if (process.env.LOG_STARTUP_ENV !== "1") {
    return;
  }
  const globalScope = globalThis as typeof globalThis & {
    __authStartupEnvLogged?: boolean;
  };
  if (globalScope.__authStartupEnvLogged) {
    return;
  }
  globalScope.__authStartupEnvLogged = true;
  console.info("[auth][startup-env]", {
    NODE_ENV: process.env.NODE_ENV ?? "",
    PORT: process.env.PORT ?? "",
    AUTH_PUBLIC_URL: process.env.AUTH_PUBLIC_URL ?? "",
    AUTH_ISSUER: process.env.AUTH_ISSUER ?? "",
    AUTH_SQLITE_PATH: process.env.AUTH_SQLITE_PATH ?? "",
    AUTH_TRUSTED_ORIGINS: process.env.AUTH_TRUSTED_ORIGINS ?? "",
    AUTH_REDIRECT_ORIGINS: process.env.AUTH_REDIRECT_ORIGINS ?? "",
    AUTH_SUPPORTED_SCOPES: process.env.AUTH_SUPPORTED_SCOPES ?? "",
  });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  if (process.env.NODE_ENV === "test") {
    return;
  }
  logAuthStartupEnvOnce();
}

export {};

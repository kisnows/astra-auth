/** 中文注释：登录页只接收非秘密展示字段，避免把完整 OAuthClient 序列化到浏览器。 */
export type LoginApplication = {
  appName: string;
  description: string | null;
  origin: string;
};

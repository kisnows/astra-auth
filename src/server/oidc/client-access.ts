/** 中文注释：NULL 保留旧客户端的访问范围；无效授权配置一律拒绝。 */
export function clientAllowsUser(client: { status: string; allowedUserIds: string | null }, userId: string) {
  if (client.status !== "active") return false;
  if (client.allowedUserIds === null) return true;
  try {
    const ids: unknown = JSON.parse(client.allowedUserIds);
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") && ids.includes(userId);
  } catch {
    return false;
  }
}

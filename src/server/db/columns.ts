import { customType } from "drizzle-orm/sqlite-core";

export const dateTimeText = customType<{
  data: Date | null;
  driverData: string | null;
}>({
  dataType() {
    return "text";
  },
  // 统一将 Date 转为 ISO 字符串，保证数据库落盘一致性
  toDriver(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return new Date(value).toISOString();
  },
  // 从数据库读出后恢复为 Date，避免上层重复解析
  fromDriver(value) {
    if (!value) return null;
    return new Date(value);
  },
});

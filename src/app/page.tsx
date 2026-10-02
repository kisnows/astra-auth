import { redirect } from "next/navigation";

/** 中文注释：统一入口交给账户首页校验会话，避免登录后回到登录页。 */
export default function AuthIndexPage() {
  redirect("/account");
}

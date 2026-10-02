import { redirect } from "next/navigation";

/** 中文注释：兼容旧书签和进行中的第三方绑定回调，保留结果后进入账户首页。 */
export default async function ConnectionsPage({ searchParams }: {
  searchParams: Promise<{ result?: string; federationError?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.result) query.set("result", params.result);
  if (params.federationError) query.set("federationError", params.federationError);
  redirect(`/account${query.size ? `?${query}` : ""}`);
}

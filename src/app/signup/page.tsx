import { redirect } from "next/navigation";

export default async function LegacySignUpPage(props: {
  searchParams?: Promise<{ callbackUrl?: string }>;
}) {
  const params = await props.searchParams;
  const target = new URL("/sign-up", "http://localhost");
  if (params?.callbackUrl) {
    target.searchParams.set("callbackUrl", params.callbackUrl);
  }
  redirect(`${target.pathname}${target.search}`);
}

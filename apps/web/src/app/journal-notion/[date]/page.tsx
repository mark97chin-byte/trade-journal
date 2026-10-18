import { redirect } from "next/navigation";

export default async function LegacyJournalNotionRedirect({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  redirect(`/journal/${date}`);
}

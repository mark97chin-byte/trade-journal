import { redirect } from "next/navigation";

export default async function LegacyWeeklyJournalRedirect({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const target = sp.week || sp.date;
  if (target) {
    redirect(`/journal/${target.startsWith("week-") ? target : `week-${target}`}`);
  }
  redirect("/journal");
}

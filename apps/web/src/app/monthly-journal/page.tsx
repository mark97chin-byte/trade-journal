import { redirect } from "next/navigation";

export default async function LegacyMonthlyJournalRedirect({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const sp = await searchParams;
  if (sp.month && sp.month.includes("-")) {
    redirect(`/journal/month-${sp.month}`);
  } else if (sp.year && sp.month) {
    redirect(`/journal/month-${sp.year}-${String(sp.month).padStart(2, "0")}`);
  }
  redirect("/journal");
}

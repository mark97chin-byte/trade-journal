import { getJournalEntryWithTrades } from "@/server/journal-service";
import { JournalEntryEditor } from "@/components/journal/journal-entry-editor";

export const dynamic = "force-dynamic";

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { entry, trades, range } = await getJournalEntryWithTrades(slug);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <JournalEntryEditor
        initialEntry={entry}
        trades={trades}
        range={range}
      />
    </div>
  );
}

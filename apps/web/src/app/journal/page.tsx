import { Suspense } from "react";
import { getJournalTrades } from "@/server/journal-service";
import { JournalView } from "@/components/journal/journal-view";
import { Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const trades = await getJournalTrades();

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        }
      >
        <JournalView trades={trades} />
      </Suspense>
    </div>
  );
}

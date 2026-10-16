import Link from "next/link";
import { ArrowLeft, Calendar, FileText, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function JournalEntryPlaceholderPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const getPeriodLabel = (s: string) => {
    if (s.startsWith("week-")) return { type: "Weekly Journal", period: s.replace("week-", "Week of ") };
    if (s.startsWith("month-")) return { type: "Monthly Journal", period: s.replace("month-", "") };
    if (s.startsWith("quarter-")) return { type: "Quarterly Journal", period: s.replace("quarter-", "") };
    if (s.startsWith("year-")) return { type: "Yearly Journal", period: s.replace("year-", "") };
    return { type: "Daily Journal", period: s };
  };

  const info = getPeriodLabel(slug);

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between border-b border-border/50 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/journal"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-[#161822] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Journal</span>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">
                {info.type}
              </span>
            </div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-400" />
              <span>{info.period}</span>
            </h1>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border/70 bg-[#12141d] p-10 text-center space-y-3">
        <div className="mx-auto w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400">
          <FileText className="w-5 h-5" />
        </div>
        <h2 className="text-base font-bold text-foreground">
          {info.type} Workspace ({info.period})
        </h2>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          This dedicated journal view (<code>/journal/{slug}</code>) is ready as a placeholder for your custom review template, session notes, psychological reflection, and trade breakdowns.
        </p>
      </div>
    </div>
  );
}

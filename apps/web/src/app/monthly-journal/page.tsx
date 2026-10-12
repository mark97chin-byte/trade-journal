"use client";

import React, { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Layers } from "lucide-react";

function MonthlyJournalContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const monthParam = searchParams.get("month") || "";
  const displayTitle = monthParam
    ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
        new Date(`${monthParam}-01T00:00:00`)
      )
    : "Current Month";

  return (
    <div className="mx-auto max-w-4xl p-8 space-y-6">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Calendar
      </button>

      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-400">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Monthly Journal — {displayTitle}
            </h1>
            <p className="text-xs text-muted-foreground">
              High-level monthly trade analysis, risk curves, and psychological goals.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-border/60 p-12 text-center">
          <Layers className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          <h3 className="text-sm font-semibold">Monthly Journal Module Coming Soon</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            This module will house monthly P&L summaries, R-multiple expectancy graphs, and monthly retrospective templates.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function MonthlyJournalPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading month...</div>}>
      <MonthlyJournalContent />
    </Suspense>
  );
}
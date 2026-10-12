"use client";

import React, { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Calendar, FileText } from "lucide-react";

function WeeklyJournalContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const year = searchParams.get("year") || new Date().getFullYear();
  const week = searchParams.get("week") || "1";

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
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Weekly Journal — Week {week}, {year}
            </h1>
            <p className="text-xs text-muted-foreground">
              Weekly review, execution score, and multi-day strategy alignment.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-border/60 p-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          <h3 className="text-sm font-semibold">Weekly Journal Module Coming Soon</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            This page is ready to connect with weekly trade aggregates, Notion reviews, or rule adherence metrics.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function WeeklyJournalPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading week...</div>}>
      <WeeklyJournalContent />
    </Suspense>
  );
}
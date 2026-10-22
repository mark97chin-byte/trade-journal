"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/use-api";
import { fmtMoney } from "@/lib/utils";

export function MissedTradesReportView({ query }: { query: string }) {
  const { data, loading } = useApi<any>(`/api/reports/missed-analytics?${query}`);

  if (loading || !data?.summary) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground">
        Calculating Opportunity Cost &amp; Model Potential...
      </div>
    );
  }

  const { summary, byReason = [], bySession = [], byHour = [], byDayOfWeek = [], byPlaybookRule = [] } = data;
  const topReason = byReason[0];
  const topSession = bySession[0];
  const topHour = byHour[0];

  return (
    <div className="space-y-6">
      {/* 1. ACTUAL EXECUTED VS MISSED OPPORTUNITY VS FULL MODEL POTENTIAL */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border/70 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              1. Actual Executed Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div
              className={`text-2xl font-bold font-mono ${
                summary.executed.netPnl >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {fmtMoney(summary.executed.netPnl)}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Executed Trades: <strong className="text-foreground">{summary.executed.count}</strong>
              </span>
              <span>
                Win Rate: <strong className="text-foreground">{summary.executed.winRate}%</strong>
              </span>
              <span>
                Net R: <strong className="text-foreground font-mono">{summary.executed.netR}R</strong>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              2. Opportunity Missed (Left on Table)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div
              className={`text-2xl font-bold font-mono ${
                summary.missed.netPnl >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {fmtMoney(summary.missed.netPnl)}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Missed Setups: <strong className="text-foreground">{summary.missed.count}</strong>
              </span>
              <span>
                Missed Win Rate: <strong className="text-foreground">{summary.missed.winRate}%</strong>
              </span>
              <span>
                Missed R:{" "}
                <strong className="text-foreground font-mono">
                  {summary.missed.netR >= 0 ? `+${summary.missed.netR}R` : `${summary.missed.netR}R`}
                </strong>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              3. Full Model Potential (Executed + Missed)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div
              className={`text-2xl font-bold font-mono ${
                summary.combinedModel.netPnl >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {fmtMoney(summary.combinedModel.netPnl)}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Total Setups: <strong className="text-foreground">{summary.combinedModel.count}</strong>
              </span>
              <span>
                Model Win Rate:{" "}
                <strong className="text-foreground">{summary.combinedModel.winRate}%</strong>
              </span>
              <span>
                Model R:{" "}
                <strong className="text-foreground font-mono">{summary.combinedModel.netR}R</strong>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2. TOP BEHAVIORAL INSIGHTS BANNER */}
      {summary.missed.count > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Most Common Reason Missed
            </div>
            <div className="text-sm font-bold text-foreground mt-1">
              {topReason?.reason || "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {topReason
                ? `${topReason.count} setups (${Math.round(
                    (topReason.count / summary.missed.count) * 100
                  )}%) • ${fmtMoney(topReason.pnl)} (${topReason.r.toFixed(2)}R)`
                : ""}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Most Common ICT Session Missed
            </div>
            <div className="text-sm font-bold text-foreground mt-1">
              {topSession?.session || "—"} Session
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {topSession
                ? `${topSession.count} setups • ${fmtMoney(topSession.pnl)} (${topSession.r.toFixed(
                    2
                  )}R)`
                : ""}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Peak Hour for Missed Setups (NY Time)
            </div>
            <div className="text-sm font-bold text-foreground mt-1">
              {topHour?.hour || "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {topHour
                ? `${topHour.count} setups missed during this hour (${fmtMoney(topHour.pnl)})`
                : ""}
            </div>
          </div>
        </div>
      )}

      {/* 3. DETAILED BREAKDOWN TABLES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">
              Opportunity Cost by Reason Missed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {byReason.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No missed trades recorded in this date range.
              </p>
            ) : (
              byReason.map((r: any) => {
                const pct =
                  summary.missed.count > 0
                    ? Math.round((r.count / summary.missed.count) * 100)
                    : 0;
                return (
                  <div
                    key={r.reason}
                    className="rounded-lg border border-border/50 bg-secondary/20 p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-foreground">{r.reason}</span>
                      <span className="font-mono font-bold text-foreground">
                        {fmtMoney(r.pnl)} (
                        {r.r >= 0 ? `+${r.r.toFixed(2)}R` : `${r.r.toFixed(2)}R`})
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        style={{ width: `${Math.max(4, pct)}%` }}
                        className="h-full bg-foreground rounded-full"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {r.count} missed ({pct}% of misses)
                      </span>
                      <span>
                        Theoretical Win Rate: {Math.round((r.wins / r.count) * 100)}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">
              When Trades Are Missed (Session, NY Hour &amp; Day of Week)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                By ICT Session
              </div>
              <div className="grid grid-cols-2 gap-2">
                {bySession.map((s: any) => (
                  <div
                    key={s.session}
                    className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-foreground">{s.session}</div>
                      <div className="text-[10px] text-muted-foreground">{s.count} setups</div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-bold text-foreground">{fmtMoney(s.pnl)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.r >= 0 ? `+${s.r.toFixed(2)}R` : `${s.r.toFixed(2)}R`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                By Hour of Day (America/New_York)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {byHour.map((h: any) => (
                  <span
                    key={h.hour}
                    className="rounded-md border border-border/50 bg-secondary/20 px-2.5 py-1 text-xs font-mono"
                  >
                    <strong className="text-foreground">{h.hour}</strong>: {h.count} (
                    {fmtMoney(h.pnl)})
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                By Day of Week
              </div>
              <div className="flex flex-wrap gap-1.5">
                {byDayOfWeek.map((d: any) => (
                  <span
                    key={d.day}
                    className="rounded-md border border-border/50 bg-secondary/20 px-2.5 py-1 text-xs"
                  >
                    <strong className="text-foreground">{d.day}</strong>: {d.count} (
                    {fmtMoney(d.pnl)})
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4. PLAYBOOK RULES MATCHED ON MISSED TRADES */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">
            Playbook Rules Matched on Missed Setups
          </CardTitle>
        </CardHeader>
        <CardContent>
          {byPlaybookRule.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Select a Playbook and check off matched rules on your Missed Trades to track rule-level opportunity cost here.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {byPlaybookRule.map((item: any) => (
                <div
                  key={`${item.playbookName}-${item.rule}`}
                  className="rounded-lg border border-border/50 bg-secondary/20 p-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {item.playbookName}
                    </div>
                    <div className="font-semibold text-foreground truncate">{item.rule}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Matched in {item.count} missed setup(s) • Win Rate:{" "}
                      {Math.round((item.wins / item.count) * 100)}%
                    </div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div
                      className={`font-bold ${
                        item.pnl >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {fmtMoney(item.pnl)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {item.r >= 0 ? `+${item.r.toFixed(2)}R` : `${item.r.toFixed(2)}R`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
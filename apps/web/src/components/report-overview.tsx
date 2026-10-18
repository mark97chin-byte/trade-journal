"use client";

import type { AnalysisFilters, BucketStats } from "@luxalgo/journal-core";
import { TimeHeatmap } from "./charts/time-heatmap";
import { MonetaryValue } from "./privacy";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { useApi } from "@/lib/use-api";
import { fmtMoney, fmtPercent, pnlClass } from "@/lib/utils";
import { YourStatsOverview } from "./reports/your-stats-overview";
import { ReportMetricChart } from "./reports/report-metric-chart";

interface OverviewData {
  buckets: Record<
    "symbol" | "tag" | "mistake" | "playbook" | "weekday" | "hour" | "duration" | "direction",
    BucketStats[]
  >;
  currencies: string[];
  timeZone: string;
  accounts: { id: string; name: string }[];
  playbooks: { id: string; name: string }[];
}

const SECTIONS = [
  { key: "symbol", title: "By symbol" },
  { key: "direction", title: "Long vs short" },
  { key: "weekday", title: "By weekday" },
  { key: "duration", title: "By holding time" },
  { key: "tag", title: "By tag" },
  { key: "mistake", title: "By mistake" },
  { key: "playbook", title: "By playbook" },
] as const;

export function ReportOverview({
  query,
  dateLabel = "All dates",
}: {
  query: string;
  filters?: AnalysisFilters;
  dateLabel?: string;
}) {
  const { data, error, loading } = useApi<OverviewData>(`/api/stats?${query}`);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );

  if (loading || !data) return <Skeleton className="h-72" />;

  if (data.currencies.length > 1)
    return (
      <p className="rounded-lg border p-4 text-sm">
        These accounts use different currencies ({data.currencies.join(", ")}). Select accounts with
        the same currency in Filters to compare monetary results.
      </p>
    );

  const currency = data.currencies[0] ?? "USD";

  return (
    <div className="space-y-6">
      {/* 1. TradeZella Your stats overview card with dynamic date */}
      <YourStatsOverview query={query} dateLabel={dateLabel} />

      {/* 2. Side-by-side Metric Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportMetricChart
          dimension="weekday"
          defaultMetrics={[
            { key: "netPnl", chartType: "area", color: "#ef4444" },
            { key: "tradeCount", chartType: "line", color: "#3b82f6" },
          ]}
        />
        <ReportMetricChart
          dimension="weekday"
          defaultMetrics={[{ key: "winRate", chartType: "bar", color: "var(--profit-fill, #0ca30c)" }]}
        />
      </div>

      {/* 3. Trade Time Performance */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Trade time performance</CardTitle>
        </CardHeader>
        <CardContent>
          <TimeHeatmap
            currency={currency}
            hours={data.buckets.hour.map((b) => ({
              key: b.key,
              netPnl: b.netPnl,
              trades: b.trades,
            }))}
          />
        </CardContent>
      </Card>

      {/* 4. Breakdown Tables */}
      {SECTIONS.map((section) => {
        const rows = data.buckets[section.key] ?? [];
        if (rows.length === 0) return null;

        return (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{section.title.replace("By ", "")}</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Win %</TableHead>
                    <TableHead className="text-right">Net P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.key}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.trades}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPercent(row.winRate)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${pnlClass(row.netPnl)}`}>
                        <MonetaryValue>{fmtMoney(row.netPnl, currency)}</MonetaryValue>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

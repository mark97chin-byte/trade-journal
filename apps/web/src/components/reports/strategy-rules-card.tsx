"use client";

import React, { useState, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  CheckSquare,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Filter,
  Sparkles,
  X,
} from "lucide-react";

export interface PlaybookRuleMeta {
  playbookId: string;
  playbookName: string;
  playbookIcon: string;
  groupName: string;
  ruleText: string;
  frequency: string;
}

export interface RuleCheckRecord {
  tradeKey: string;
  playbookId: string;
  rule: string;
  followed: boolean;
}

export interface StrategyRulesAnalysisData {
  playbooks: {
    id: string;
    name: string;
    icon: string;
  }[];
  rules: PlaybookRuleMeta[];
  checks: RuleCheckRecord[];
}

function fmtMoney(val: number): string {
  if (isNaN(val) || Math.abs(val) < 0.005) return "$0.00";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : "+$";
  return `${sign}${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function computeSubsetStats(trades: any[]) {
  const count = trades.length;
  let netPnl = 0;
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;

  for (const t of trades) {
    const pnl = Number(t.netPnl ?? t.pnl ?? 0);
    netPnl += pnl;
    if (pnl > 0.0001 || t.status === "win") {
      wins++;
      grossWin += pnl;
    } else if (pnl < -0.0001 || t.status === "loss") {
      losses++;
      grossLoss += Math.abs(pnl);
    }
  }

  const winRate = count > 0 ? (wins / count) * 100 : 0;
  const avgWin = wins > 0 ? grossWin / wins : 0;
  const avgLoss = losses > 0 ? -(grossLoss / losses) : 0;
  const lossRate = count > 0 ? losses / count : 0;
  const expectancy = (winRate / 100) * avgWin + lossRate * avgLoss;
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  return {
    count,
    wins,
    losses,
    netPnl,
    winRate,
    avgWin,
    avgLoss,
    expectancy,
    profitFactor,
  };
}

export function StrategyRulesCard({
  trades = [],
  ruleAnalysis,
}: {
  trades: any[];
  ruleAnalysis?: StrategyRulesAnalysisData;
}) {
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("all");
  const [matchMode, setMatchMode] = useState<"AND" | "OR">("AND");
  // Selected rule keys in format `${playbookId}::${ruleText}`
  const [selectedRuleKeys, setSelectedRuleKeys] = useState<string[]>([]);

  const playbooks = ruleAnalysis?.playbooks ?? [];
  const allRules = ruleAnalysis?.rules ?? [];
  const allChecks = ruleAnalysis?.checks ?? [];

  // Map each tradeKey -> Set of `${playbookId}::${rule}` that were followed
  const followedMapByTradeKey = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const c of allChecks) {
      if (!c.followed) continue;
      const set = map.get(c.tradeKey) ?? new Set<string>();
      set.add(`${c.playbookId}::${c.rule}`);
      map.set(c.tradeKey, set);
    }
    return map;
  }, [allChecks]);

  const didTradeFollowRule = (trade: any, ruleKey: string): boolean => {
    const k1 = trade.key ? String(trade.key) : "";
    const k2 = trade.id ? String(trade.id) : "";
    return (
      (k1 !== "" && Boolean(followedMapByTradeKey.get(k1)?.has(ruleKey))) ||
      (k2 !== "" && Boolean(followedMapByTradeKey.get(k2)?.has(ruleKey)))
    );
  };

  // Filter rules by selected playbook
  const visibleRules = useMemo(() => {
    if (selectedPlaybookId === "all") return allRules;
    return allRules.filter((r) => r.playbookId === selectedPlaybookId);
  }, [allRules, selectedPlaybookId]);

  // Compute individual stats per rule
  const ruleRowsWithStats = useMemo(() => {
    return visibleRules.map((r) => {
      const ruleKey = `${r.playbookId}::${r.ruleText}`;
      const pbTrades = trades.filter((t) => t.playbookId === r.playbookId);
      const followedTrades = pbTrades.filter((t) => didTradeFollowRule(t, ruleKey));
      const unfollowedTrades = pbTrades.filter((t) => !didTradeFollowRule(t, ruleKey));

      const followedStats = computeSubsetStats(followedTrades);
      const unfollowedStats = computeSubsetStats(unfollowedTrades);
      const baselineStats = computeSubsetStats(pbTrades);

      const followRate =
        pbTrades.length > 0 ? (followedTrades.length / pbTrades.length) * 100 : 0;

      // Win rate delta vs when not followed (or vs strategy baseline if all/none)
      const comparisonBaseWinRate =
        unfollowedTrades.length > 0
          ? unfollowedStats.winRate
          : baselineStats.winRate;
      const winRateDelta =
        followedTrades.length > 0
          ? followedStats.winRate - comparisonBaseWinRate
          : 0;

      return {
        ...r,
        ruleKey,
        pbTradesCount: pbTrades.length,
        followRate,
        followedStats,
        unfollowedStats,
        baselineStats,
        winRateDelta,
      };
    });
  }, [visibleRules, trades, followedMapByTradeKey]);

  // Compute Multi-Rule Combination Simulator stats
  const combinationComparison = useMemo(() => {
    if (selectedRuleKeys.length === 0) return null;

    // Determine relevant pool of strategy trades
    const relevantPlaybookIds = new Set(
      selectedRuleKeys.map((k) => k.split("::")[0]!)
    );

    const poolTrades = trades.filter((t) =>
      selectedPlaybookId !== "all"
        ? t.playbookId === selectedPlaybookId
        : t.playbookId && relevantPlaybookIds.has(t.playbookId)
    );

    const matchingTrades = poolTrades.filter((t) => {
      if (matchMode === "AND") {
        return selectedRuleKeys.every((rk) => didTradeFollowRule(t, rk));
      } else {
        return selectedRuleKeys.some((rk) => didTradeFollowRule(t, rk));
      }
    });

    const nonMatchingTrades = poolTrades.filter(
      (t) => !matchingTrades.includes(t)
    );

    const followed = computeSubsetStats(matchingTrades);
    const notFollowed = computeSubsetStats(nonMatchingTrades);
    const baseline = computeSubsetStats(poolTrades);

    const deltaVsBaseline =
      followed.count > 0 ? followed.winRate - baseline.winRate : 0;
    const deltaVsNotFollowed =
      followed.count > 0 && notFollowed.count > 0
        ? followed.winRate - notFollowed.winRate
        : deltaVsBaseline;

    return {
      followed,
      notFollowed,
      baseline,
      deltaVsBaseline,
      deltaVsNotFollowed,
    };
  }, [selectedRuleKeys, matchMode, trades, selectedPlaybookId, followedMapByTradeKey]);

  const toggleRuleSelection = (ruleKey: string) => {
    setSelectedRuleKeys((prev) =>
      prev.includes(ruleKey)
        ? prev.filter((k) => k !== ruleKey)
        : [...prev, ruleKey]
    );
  };

  return (
    <div className="rounded-xl border border-border/50 bg-[#12141a] p-5 shadow-sm space-y-5">
      {/* HEADER & CONTROLS */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-foreground">
              Strategy Rules Winrate &amp; Multi-Rule Impact
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Check one or multiple rules below to see if following them together improves your win rate and expectancy.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Playbook Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={selectedPlaybookId}
              onChange={(e) => {
                setSelectedPlaybookId(e.target.value);
                setSelectedRuleKeys([]);
              }}
              className="h-8 rounded-lg border border-border/60 bg-[#161822] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
            >
              <option value="all">All strategies</option>
              {playbooks.map((pb) => (
                <option key={pb.id} value={pb.id}>
                  {pb.icon} {pb.name}
                </option>
              ))}
            </select>
          </div>

          {/* AND / OR Mode Toggle */}
          <div className="flex items-center rounded-lg border border-border/50 bg-[#161822] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMatchMode("AND")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                matchMode === "AND"
                  ? "bg-[#4f46e5] text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Trades where ALL selected rules were followed"
            >
              Match ALL (AND)
            </button>
            <button
              type="button"
              onClick={() => setMatchMode("OR")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                matchMode === "OR"
                  ? "bg-[#4f46e5] text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Trades where ANY of the selected rules were followed"
            >
              Match ANY (OR)
            </button>
          </div>

          {selectedRuleKeys.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedRuleKeys([])}
              className="h-8 text-xs gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Clear ({selectedRuleKeys.length})</span>
            </Button>
          )}
        </div>
      </div>

      {/* MULTI-RULE COMBINATION COMPARISON PANEL */}
      {combinationComparison ? (
        <div className="rounded-xl border border-indigo-500/30 bg-[#161822]/90 p-4 space-y-4">
          {/* Active rule pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300 mr-1">
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                Comparing {selectedRuleKeys.length}{" "}
                {selectedRuleKeys.length === 1 ? "rule" : "rules"} ({matchMode}):
              </span>
            </span>
            {selectedRuleKeys.map((rk) => {
              const [, ruleText] = rk.split("::");
              return (
                <span
                  key={rk}
                  className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-medium text-foreground"
                >
                  <span className="max-w-[220px] truncate">{ruleText}</span>
                  <button
                    type="button"
                    onClick={() => toggleRuleSelection(rk)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>

          {/* 3-Column Comparison Cards */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* 1. When Selected Rules Followed */}
            <div className="rounded-xl border border-emerald-500/30 bg-[#0d0f14] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-400">
                  When Selected Rules Followed
                </span>
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 tabular-nums">
                  {combinationComparison.followed.count} trades
                </span>
              </div>

              <div className="flex items-baseline gap-2.5 pt-1">
                <span className="text-2xl font-bold text-foreground tabular-nums">
                  {combinationComparison.followed.winRate.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground">win rate</span>
                {combinationComparison.followed.count > 0 && (
                  <span
                    className={`ml-auto inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                      combinationComparison.deltaVsNotFollowed > 0
                        ? "bg-emerald-500/20 text-emerald-300"
                        : combinationComparison.deltaVsNotFollowed < 0
                        ? "bg-rose-500/20 text-rose-300"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {combinationComparison.deltaVsNotFollowed > 0 ? "+" : ""}
                    {combinationComparison.deltaVsNotFollowed.toFixed(1)}% vs unfollowed
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-border/30 pt-2.5 text-[11px]">
                <div>
                  <span className="text-muted-foreground block">Net P&amp;L</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      combinationComparison.followed.netPnl >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {fmtMoney(combinationComparison.followed.netPnl)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Profit Factor</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {combinationComparison.followed.profitFactor === 99
                      ? "∞"
                      : combinationComparison.followed.profitFactor.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Expectancy</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {fmtMoney(combinationComparison.followed.expectancy)}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. When Selected Rules NOT Followed */}
            <div className="rounded-xl border border-rose-500/30 bg-[#0d0f14] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-rose-400">
                  When Rules NOT Followed
                </span>
                <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-300 tabular-nums">
                  {combinationComparison.notFollowed.count} trades
                </span>
              </div>

              <div className="flex items-baseline gap-2.5 pt-1">
                <span className="text-2xl font-bold text-foreground tabular-nums">
                  {combinationComparison.notFollowed.winRate.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground">win rate</span>
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-border/30 pt-2.5 text-[11px]">
                <div>
                  <span className="text-muted-foreground block">Net P&amp;L</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      combinationComparison.notFollowed.netPnl >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {fmtMoney(combinationComparison.notFollowed.netPnl)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Profit Factor</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {combinationComparison.notFollowed.profitFactor === 99
                      ? "∞"
                      : combinationComparison.notFollowed.profitFactor.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Expectancy</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {fmtMoney(combinationComparison.notFollowed.expectancy)}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Strategy Baseline */}
            <div className="rounded-xl border border-border/50 bg-[#0d0f14] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  Strategy Baseline (All Trades)
                </span>
                <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-bold text-foreground tabular-nums">
                  {combinationComparison.baseline.count} trades
                </span>
              </div>

              <div className="flex items-baseline gap-2.5 pt-1">
                <span className="text-2xl font-bold text-foreground tabular-nums">
                  {combinationComparison.baseline.winRate.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground">win rate</span>
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-border/30 pt-2.5 text-[11px]">
                <div>
                  <span className="text-muted-foreground block">Net P&amp;L</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      combinationComparison.baseline.netPnl >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {fmtMoney(combinationComparison.baseline.netPnl)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Profit Factor</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {combinationComparison.baseline.profitFactor === 99
                      ? "∞"
                      : combinationComparison.baseline.profitFactor.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Expectancy</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {fmtMoney(combinationComparison.baseline.expectancy)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 bg-[#161822]/40 px-4 py-3 text-xs text-muted-foreground flex items-center justify-between">
          <span>
            💡 Tip: Check one or multiple rules in the table below to simulate their combined Win % and P&amp;L impact.
          </span>
        </div>
      )}

      {/* INDIVIDUAL RULES WINRATE TABLE */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border/40 text-muted-foreground">
            <tr>
              <th className="w-9 py-2.5 pl-2">
                <Checkbox
                  checked={
                    ruleRowsWithStats.length > 0 &&
                    ruleRowsWithStats.every((r) =>
                      selectedRuleKeys.includes(r.ruleKey)
                    )
                  }
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedRuleKeys(ruleRowsWithStats.map((r) => r.ruleKey));
                    } else {
                      setSelectedRuleKeys([]);
                    }
                  }}
                />
              </th>
              <th className="py-2.5 font-medium">Rule</th>
              <th className="py-2.5 font-medium">Strategy</th>
              <th className="py-2.5 text-right font-medium">Follow rate</th>
              <th className="py-2.5 text-right font-medium">Win % (Followed)</th>
              <th className="py-2.5 text-right font-medium">Win % (Unfollowed)</th>
              <th className="py-2.5 text-right font-medium">Win % Impact</th>
              <th className="py-2.5 text-right font-medium">Net P&amp;L (Followed)</th>
              <th className="py-2.5 text-right font-medium pr-2">Profit factor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {ruleRowsWithStats.map((r, idx) => {
              const isSelected = selectedRuleKeys.includes(r.ruleKey);
              const f = r.followedStats;
              const u = r.unfollowedStats;

              return (
                <tr
                  key={`${r.ruleKey}-${idx}`}
                  onClick={() => toggleRuleSelection(r.ruleKey)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-indigo-500/15 hover:bg-indigo-500/20"
                      : "hover:bg-secondary/20"
                  }`}
                >
                  <td
                    className="py-3 pl-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleRuleSelection(r.ruleKey)}
                    />
                  </td>

                  <td className="py-3 pr-3">
                    <div className="font-medium text-foreground">{r.ruleText}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{r.groupName}</span>
                      <span>•</span>
                      <span>{r.frequency}</span>
                    </div>
                  </td>

                  <td className="py-3 whitespace-nowrap text-muted-foreground">
                    <span className="mr-1">{r.playbookIcon}</span>
                    <span className="text-foreground/90">{r.playbookName}</span>
                  </td>

                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {r.followRate.toFixed(0)}%{" "}
                    <span className="text-[10px]">
                      ({f.count}/{r.pbTradesCount})
                    </span>
                  </td>

                  <td className="py-3 text-right tabular-nums">
                    <div className="inline-flex flex-col items-end gap-1">
                      <span className="font-bold text-foreground">
                        {f.count > 0 ? `${f.winRate.toFixed(1)}%` : "0%"}
                      </span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full ${
                            f.winRate >= 50 ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                          style={{ width: `${Math.min(100, f.winRate)}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {u.count > 0 ? `${u.winRate.toFixed(1)}%` : "-"}
                  </td>

                  <td className="py-3 text-right tabular-nums">
                    {f.count > 0 ? (
                      <span
                        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          r.winRateDelta > 0.05
                            ? "bg-emerald-500/15 text-emerald-400"
                            : r.winRateDelta < -0.05
                            ? "bg-rose-500/15 text-rose-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {r.winRateDelta > 0.05 && (
                          <TrendingUp className="h-3 w-3 mr-0.5" />
                        )}
                        {r.winRateDelta < -0.05 && (
                          <TrendingDown className="h-3 w-3 mr-0.5" />
                        )}
                        {r.winRateDelta > 0 ? "+" : ""}
                        {r.winRateDelta.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>

                  <td
                    className={`py-3 text-right font-semibold tabular-nums ${
                      f.netPnl > 0
                        ? "text-emerald-400"
                        : f.netPnl < 0
                        ? "text-rose-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {fmtMoney(f.netPnl)}
                  </td>

                  <td className="py-3 text-right tabular-nums text-foreground pr-2">
                    {f.count > 0
                      ? f.profitFactor === 99
                        ? "∞"
                        : f.profitFactor.toFixed(2)
                      : "N/A"}
                  </td>
                </tr>
              );
            })}

            {ruleRowsWithStats.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="py-8 text-center text-xs text-muted-foreground"
                >
                  No strategy rules found. Add rules to your playbooks to track their win rate impact.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { readFilters } from "@luxalgo/journal-core";
import { db, playbooks as playbooksTable, tradeRuleChecks } from "@/db";
import { ensurePlaybookTables, getMetaRow, normalizeRuleGroups } from "@/server/playbooks-store";
import { handler, ok } from "@/server/api";
import { queryTrades } from "@/server/trades-query";
import { extractTradeTokens, getTagsWithUsage } from "@/server/tags-store";
import { queryMissedTradesAsAnnotated } from "@/server/missed-trades-bridge";
import { classifyKillzoneAnd7hCandle } from "@/lib/killzones";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DURATION_BUCKETS = [
  { key: "<5m", label: "< 5m (Scalp)", min: 0, max: 5 * 60_000 },
  { key: "5-15m", label: "5m – 15m", min: 5 * 60_000, max: 15 * 60_000 },
  { key: "15-30m", label: "15m – 30m", min: 15 * 60_000, max: 30 * 60_000 },
  { key: "30-60m", label: "30m – 1h", min: 30 * 60_000, max: 60 * 60_000 },
  { key: "1-2h", label: "1h – 2h", min: 60 * 60_000, max: 120 * 60_000 },
  { key: "2-4h", label: "2h – 4h", min: 120 * 60_000, max: 240 * 60_000 },
  { key: "4h+", label: "4h+ (Intraday Swing)", min: 240 * 60_000, max: Infinity },
];

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return Number(sorted[idx]!.toFixed(2));
}

function getTradeDurationMs(t: any): number | null {
  if (typeof t.durationMs === "number" && t.durationMs > 0) return t.durationMs;
  const openMs = t.openedAt ? Date.parse(t.openedAt) : NaN;
  const closeMs = (t.closedAt ?? t.closeTime ?? t.exitTime)
    ? Date.parse(t.closedAt ?? t.closeTime ?? t.exitTime)
    : NaN;
  if (Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs >= openMs) {
    return closeMs - openMs;
  }
  return null;
}

function getEffectiveR(t: any): number {
  if (typeof t.realizedR === "number" && Number.isFinite(t.realizedR)) {
    return t.realizedR;
  }
  const pnl = Number(t.netPnl ?? t.pnl ?? 0);
  if (pnl > 0.0001 || t.status === "win") return 1.0;
  if (pnl < -0.0001 || t.status === "loss") return -1.0;
  return 0;
}

function computeQuantBucketMetrics(trades: any[]) {
  const n = trades.length;
  const executedCount = trades.filter((t) => !t.isMissed).length;
  const missedCount = trades.filter((t) => Boolean(t.isMissed)).length;

  let wins = 0;
  let losses = 0;
  let be = 0;
  let netPnl = 0;
  let grossWinPnl = 0;
  let grossLossPnl = 0;

  const rList: number[] = [];
  const winRList: number[] = [];
  const lossRList: number[] = [];
  const mfeList: number[] = [];
  const winMfeList: number[] = [];
  const maeList: number[] = [];
  const winMaeList: number[] = [];
  const captureList: number[] = [];
  const riskPctList: number[] = [];

  for (const t of trades) {
    const pnl = Number(t.netPnl ?? t.pnl ?? 0);
    netPnl += pnl;

    const rVal = getEffectiveR(t);
    rList.push(rVal);

    if (typeof t.riskPercent === "number" && t.riskPercent > 0) {
      riskPctList.push(t.riskPercent);
    }

    const isWin = pnl > 0.0001 || t.status === "win" || rVal > 0.05;
    const isLoss = pnl < -0.0001 || t.status === "loss" || rVal < -0.05;

    if (isWin) {
      wins++;
      grossWinPnl += Math.max(0, pnl);
      winRList.push(Math.max(0.01, rVal));
    } else if (isLoss) {
      losses++;
      grossLossPnl += Math.abs(Math.min(0, pnl));
      lossRList.push(Math.abs(Math.min(-0.01, rVal)));
    } else {
      be++;
    }

    const effectiveMfe =
      typeof t.mfeR === "number" && Number.isFinite(t.mfeR)
        ? Math.max(t.mfeR, Math.max(0, rVal))
        : rVal > 0
        ? rVal
        : null;

    if (effectiveMfe !== null) {
      mfeList.push(effectiveMfe);
      if (isWin) {
        winMfeList.push(effectiveMfe);
        if (effectiveMfe > 0.05) {
          captureList.push(Math.min(100, Math.max(0, (rVal / effectiveMfe) * 100)));
        }
      }
    }

    const effectiveMae =
      typeof t.maeR === "number" && Number.isFinite(t.maeR)
        ? Math.abs(t.maeR)
        : null;
    if (effectiveMae !== null) {
      maeList.push(effectiveMae);
      if (isWin) winMaeList.push(effectiveMae);
    }
  }

  const winRate = n > 0 ? (wins / n) * 100 : 0;
  const totalR = rList.reduce((a, b) => a + b, 0);
  const meanR = n > 0 ? totalR / n : 0;
  const varianceR =
    n > 1
      ? rList.reduce((acc, r) => acc + Math.pow(r - meanR, 2), 0) / (n - 1)
      : 0;
  const stdDevR = Math.sqrt(varianceR);
  const stdErrorR = n > 0 ? stdDevR / Math.sqrt(n) : 0;
  const sqn = stdDevR > 0.001 && n >= 2 ? Math.sqrt(n) * (meanR / stdDevR) : 0;

  const avgWinR =
    winRList.length > 0
      ? winRList.reduce((a, b) => a + b, 0) / winRList.length
      : 0;
  const avgLossR =
    lossRList.length > 0
      ? lossRList.reduce((a, b) => a + b, 0) / lossRList.length
      : 1;
  const payoffRatioR = avgLossR > 0 ? avgWinR / avgLossR : avgWinR;

  const grossWinR = winRList.reduce((a, b) => a + b, 0);
  const grossLossR = lossRList.reduce((a, b) => a + b, 0);
  const profitFactorR =
    grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? 99 : 0;

  const wProb = n > 0 ? wins / n : 0;
  const kellyFraction =
    payoffRatioR > 0 ? Math.max(0, wProb - (1 - wProb) / payoffRatioR) : 0;

  const expectedMaxLosingStreak =
    wProb > 0 && wProb < 1
      ? Math.ceil(Math.log(100) / Math.abs(Math.log(1 - wProb)))
      : 0;

  const avgMfeR =
    mfeList.length > 0
      ? mfeList.reduce((a, b) => a + b, 0) / mfeList.length
      : null;
  const avgWinnerMfeR =
    winMfeList.length > 0
      ? winMfeList.reduce((a, b) => a + b, 0) / winMfeList.length
      : null;
  const avgMaeR =
    maeList.length > 0
      ? maeList.reduce((a, b) => a + b, 0) / maeList.length
      : null;
  const avgWinnerMaeR =
    winMaeList.length > 0
      ? winMaeList.reduce((a, b) => a + b, 0) / winMaeList.length
      : null;
  const avgCaptureEff =
    captureList.length > 0
      ? captureList.reduce((a, b) => a + b, 0) / captureList.length
      : null;

  const avgRiskPct =
    riskPctList.length > 0
      ? Number((riskPctList.reduce((a, b) => a + b, 0) / riskPctList.length).toFixed(2))
      : null;

  const runnerBleedR =
    avgWinnerMfeR !== null && avgWinR > 0
      ? Math.max(0, avgWinnerMfeR - avgWinR)
      : null;

  const sortedWinMae = [...winMaeList].sort((a, b) => a - b);
  const sortedWinMfe = [...winMfeList].sort((a, b) => a - b);

  return {
    count: n,
    executedCount,
    missedCount,
    wins,
    losses,
    be,
    winRate: Number(winRate.toFixed(1)),
    netPnl: Number(netPnl.toFixed(2)),
    totalR: Number(totalR.toFixed(2)),
    expectancyR: Number(meanR.toFixed(2)),
    stdDevR: Number(stdDevR.toFixed(2)),
    ci95LowR: Number((meanR - 1.96 * stdErrorR).toFixed(2)),
    ci95HighR: Number((meanR + 1.96 * stdErrorR).toFixed(2)),
    sqn: Number(sqn.toFixed(2)),
    avgWinR: Number(avgWinR.toFixed(2)),
    avgLossR: Number(avgLossR.toFixed(2)),
    payoffRatioR: Number(payoffRatioR.toFixed(2)),
    profitFactorR: Number(profitFactorR.toFixed(2)),
    kellyPct: Number((kellyFraction * 100).toFixed(1)),
    halfKellyPct: Number(((kellyFraction * 100) / 2).toFixed(1)),
    expectedMaxLosingStreak,
    avgRiskPct,
    avgMfeR: avgMfeR !== null ? Number(avgMfeR.toFixed(2)) : null,
    avgWinnerMfeR: avgWinnerMfeR !== null ? Number(avgWinnerMfeR.toFixed(2)) : null,
    medianWinnerMfeR: percentile(sortedWinMfe, 50),
    p75WinnerMfeR: percentile(sortedWinMfe, 75),
    avgMaeR: avgMaeR !== null ? Number(avgMaeR.toFixed(2)) : null,
    avgWinnerMaeR: avgWinnerMaeR !== null ? Number(avgWinnerMaeR.toFixed(2)) : null,
    p85WinnerMaeR: percentile(sortedWinMae, 85),
    p90WinnerMaeR: percentile(sortedWinMae, 90),
    avgCaptureEff: avgCaptureEff !== null ? Number(avgCaptureEff.toFixed(1)) : null,
    runnerBleedR: runnerBleedR !== null ? Number(runnerBleedR.toFixed(2)) : null,
  };
}

function computeMfeTargetCurve(trades: any[]) {
  const candidates: number[] = [];
  for (let t = 0.5; t <= 8.001; t += 0.25) {
    candidates.push(Number(t.toFixed(2)));
  }

  const points = candidates.map((targetR) => {
    let hitCount = 0;
    let trailingTotalR = 0;
    let strictTotalR = 0;
    let validCount = 0;

    for (const tr of trades) {
      const rVal = getEffectiveR(tr);
      const mfe =
        typeof tr.mfeR === "number" && Number.isFinite(tr.mfeR)
          ? Math.max(tr.mfeR, Math.max(0, rVal))
          : Math.max(0, rVal);

      validCount++;
      if (mfe >= targetR) {
        hitCount++;
        trailingTotalR += targetR;
        strictTotalR += targetR;
      } else {
        trailingTotalR += rVal;
        strictTotalR += rVal < 0 ? rVal : -1.0;
      }
    }

    const hitRate = validCount > 0 ? (hitCount / validCount) * 100 : 0;
    const trailingExpR = validCount > 0 ? trailingTotalR / validCount : 0;
    const strictExpR = validCount > 0 ? strictTotalR / validCount : 0;

    return {
      targetR,
      hitCount,
      hitRate: Number(hitRate.toFixed(1)),
      trailingTotalR: Number(trailingTotalR.toFixed(2)),
      trailingExpR: Number(trailingExpR.toFixed(2)),
      strictTotalR: Number(strictTotalR.toFixed(2)),
      strictExpR: Number(strictExpR.toFixed(2)),
    };
  });

  const bestTrailing =
    points.length > 0 && trades.length > 0
      ? points.reduce((a, b) => (b.trailingExpR > a.trailingExpR ? b : a))
      : null;
  const bestStrict =
    points.length > 0 && trades.length > 0
      ? points.reduce((a, b) => (b.strictExpR > a.strictExpR ? b : a))
      : null;

  return { points, bestTrailing, bestStrict };
}

function computePartialScaleOutGrid(trades: any[]) {
  if (trades.length === 0) return [];
  const tp1Pcts = [0.25, 0.5, 0.75];
  const tp1Levels = [1.0, 1.5, 2.0, 2.5];
  const tp2Levels = [2.0, 3.0, 4.0, 5.0];

  const results: Array<{
    id: string;
    label: string;
    tp1Pct: number;
    tp1R: number;
    tp2R: number;
    expectancyR: number;
    totalR: number;
    winRate: number;
    tp1HitRate: number;
    tp2HitRate: number;
  }> = [];

  for (const w1 of tp1Pcts) {
    const w2 = Number((1 - w1).toFixed(2));
    for (const r1 of tp1Levels) {
      for (const r2 of tp2Levels) {
        if (r2 <= r1) continue;
        let totalSimR = 0;
        let simWins = 0;
        let tp1Hits = 0;
        let tp2Hits = 0;
        const n = trades.length;

        for (const tr of trades) {
          const actualR = getEffectiveR(tr);
          const mfe =
            typeof tr.mfeR === "number" && Number.isFinite(tr.mfeR)
              ? Math.max(tr.mfeR, Math.max(0, actualR))
              : Math.max(0, actualR);

          let tradeSimR = actualR;
          if (mfe >= r2) {
            tp1Hits++;
            tp2Hits++;
            tradeSimR = w1 * r1 + w2 * r2;
          } else if (mfe >= r1) {
            tp1Hits++;
            const runnerR = actualR > r1 ? actualR : 0;
            tradeSimR = w1 * r1 + w2 * runnerR;
          } else {
            tradeSimR = actualR;
          }

          totalSimR += tradeSimR;
          if (tradeSimR > 0.05) simWins++;
        }

        results.push({
          id: `${Math.round(w1 * 100)}_${r1}_${r2}`,
          label: `${Math.round(w1 * 100)}% @ ${r1}R + ${Math.round(w2 * 100)}% @ ${r2}R (SL→BE)`,
          tp1Pct: Math.round(w1 * 100),
          tp1R: r1,
          tp2R: r2,
          expectancyR: Number((totalSimR / n).toFixed(2)),
          totalR: Number(totalSimR.toFixed(2)),
          winRate: Number(((simWins / n) * 100).toFixed(1)),
          tp1HitRate: Number(((tp1Hits / n) * 100).toFixed(1)),
          tp2HitRate: Number(((tp2Hits / n) * 100).toFixed(1)),
        });
      }
    }
  }

  results.sort((a, b) => b.expectancyR - a.expectancyR);
  return results.slice(0, 8);
}

function computeMaeStopSimulator(trades: any[]) {
  const stopLevels = [0.3, 0.4, 0.5, 0.6, 0.75, 0.85, 1.0];
  const n = trades.length;

  return stopLevels.map((stopR) => {
    let survivedWins = 0;
    let chokedWins = 0;
    let totalOriginalWinners = 0;
    let simTotalR = 0;

    for (const tr of trades) {
      const actualR = getEffectiveR(tr);
      const mae =
        typeof tr.maeR === "number" && Number.isFinite(tr.maeR)
          ? Math.abs(tr.maeR)
          : actualR < 0
          ? 1.0
          : 0.2;

      const isOrigWin = actualR > 0.05;
      if (isOrigWin) totalOriginalWinners++;

      if (mae > stopR) {
        if (isOrigWin) chokedWins++;
        simTotalR -= stopR;
      } else {
        if (isOrigWin) survivedWins++;
        simTotalR += actualR;
      }
    }

    return {
      stopR,
      survivedWins,
      chokedWins,
      chokedWinPct:
        totalOriginalWinners > 0
          ? Number(((chokedWins / totalOriginalWinners) * 100).toFixed(1))
          : 0,
      simTotalR: Number(simTotalR.toFixed(2)),
      simExpectancyR: n > 0 ? Number((simTotalR / n).toFixed(2)) : 0,
    };
  });
}

function computeSequentialStateBuckets(trades: any[]) {
  const sorted = [...trades].sort((a, b) =>
    String(a.openedAt || "").localeCompare(String(b.openedAt || ""))
  );

  const after1Win: any[] = [];
  const after2PlusWins: any[] = [];
  const after1Loss: any[] = [];
  const after2PlusLosses: any[] = [];

  let winStreak = 0;
  let lossStreak = 0;

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (i > 0) {
      if (winStreak >= 1) after1Win.push(t);
      if (winStreak >= 2) after2PlusWins.push(t);
      if (lossStreak >= 1) after1Loss.push(t);
      if (lossStreak >= 2) after2PlusLosses.push(t);
    }

    const rVal = getEffectiveR(t);
    const pnl = Number(t.netPnl ?? 0);
    if (pnl > 0.0001 || t.status === "win" || rVal > 0.05) {
      winStreak++;
      lossStreak = 0;
    } else if (pnl < -0.0001 || t.status === "loss" || rVal < -0.05) {
      lossStreak++;
      winStreak = 0;
    }
  }

  return [
    {
      key: "after_win",
      label: "Immediately Following a Win (1+ Win Streak)",
      metrics: computeQuantBucketMetrics(after1Win),
      optimalTargetR: computeMfeTargetCurve(after1Win).bestTrailing?.targetR ?? null,
      trades: after1Win,
    },
    {
      key: "after_loss",
      label: "Immediately Following a Loss (Post-Loss State)",
      metrics: computeQuantBucketMetrics(after1Loss),
      optimalTargetR: computeMfeTargetCurve(after1Loss).bestTrailing?.targetR ?? null,
      trades: after1Loss,
    },
    {
      key: "after_2_wins",
      label: "After 2+ Consecutive Wins (Hot Streak State)",
      metrics: computeQuantBucketMetrics(after2PlusWins),
      optimalTargetR: computeMfeTargetCurve(after2PlusWins).bestTrailing?.targetR ?? null,
      trades: after2PlusWins,
    },
    {
      key: "after_2_losses",
      label: "After 2+ Consecutive Losses (Drawdown State)",
      metrics: computeQuantBucketMetrics(after2PlusLosses),
      optimalTargetR: computeMfeTargetCurve(after2PlusLosses).bestTrailing?.targetR ?? null,
      trades: after2PlusLosses,
    },
  ].filter((row) => row.metrics.count > 0);
}

export const GET = handler(async (request: Request) => {
  const rawParams = new URL(request.url).searchParams;
  const includeMissed =
    rawParams.get("includeMissed") === "1" || rawParams.get("includeMissed") === "true";
  const selectedStrategyId =
    rawParams.get("strategyId") || rawParams.get("playbookId") || "all";

  // Strip playbookId="all" or strategyId before calling readFilters so queryTrades() never filters for literal "all"
  const cleanParams = new URLSearchParams(rawParams.toString());
  cleanParams.delete("strategyId");
  cleanParams.delete("includeMissed");
  if (cleanParams.get("playbookId") === "all") {
    cleanParams.delete("playbookId");
  }

  const filters = readFilters(cleanParams);
  const { trades: execTrades } = queryTrades(filters);
  const missedBundle = queryMissedTradesAsAnnotated(filters);

  const allPlaybooks = db.select().from(playbooksTable).all();
  const { categories: tagCategoriesList, tags: managedTagsList } = getTagsWithUsage();

  ensurePlaybookTables();
  const dbRuleChecks = db.select().from(tradeRuleChecks).all();
  const combinedRuleChecks = [
    ...dbRuleChecks,
    ...(includeMissed ? missedBundle.ruleChecks : []),
  ];

  const ruleMapByTrade = new Map<string, Set<string>>();
  for (const c of combinedRuleChecks) {
    if (!c.followed) continue;
    const s = ruleMapByTrade.get(c.tradeKey) ?? new Set<string>();
    s.add(`${c.playbookId}::${c.rule}`);
    ruleMapByTrade.set(c.tradeKey, s);
  }

  const closedExec = (execTrades as any[]).filter(
    (t) => t.status !== "open" || Boolean(t.closedAt ?? t.closeTime ?? t.exitTime)
  );
  const basePool = includeMissed
    ? [...closedExec, ...missedBundle.trades]
    : closedExec;

  const filteredPool =
    selectedStrategyId === "all"
      ? basePool
      : basePool.filter(
          (t: any) =>
            (t.playbookId ?? t.annotations?.playbook) === selectedStrategyId
        );

  const baseline = computeQuantBucketMetrics(filteredPool);
  const mfeCurve = computeMfeTargetCurve(filteredPool);
  const partialGrid = computePartialScaleOutGrid(filteredPool);
  const maeSimulator = computeMaeStopSimulator(filteredPool);

  function getTradeTagsLower(t: any): string[] {
    return [
      ...extractTradeTokens(t.tags ?? t.annotations?.tags).map((s) => s.toLowerCase()),
      ...extractTradeTokens(t.mistakes ?? t.annotations?.mistakes).map((s) => s.toLowerCase()),
    ];
  }

  // Build Mix & Match Cross-Tab Dimensions
  const byCategory: Record<string, any[]> = {};
  for (const cat of tagCategoriesList) {
    const catTags = managedTagsList.filter((mt) => mt.categoryId === cat.id);
    byCategory[cat.id] = catTags
      .map((mt) => {
        const target = mt.name.toLowerCase();
        const matched = filteredPool.filter((t) => getTradeTagsLower(t).includes(target));
        const m = computeQuantBucketMetrics(matched);
        const opt = computeMfeTargetCurve(matched).bestTrailing;
        return {
          key: mt.id,
          label: mt.name,
          categoryName: cat.name,
          color: cat.color,
          metrics: m,
          optimalTargetR: opt?.targetR ?? null,
          trades: matched,
        };
      })
      .filter((row) => row.metrics.count > 0)
      .sort((a, b) => b.metrics.expectancyR - a.metrics.expectancyR);
  }

  const kzBuckets = new Map<string, any[]>();
  const candle7hBuckets = new Map<string, any[]>();
  const dowBuckets = new Map<string, any[]>();
  const symbolBuckets = new Map<string, any[]>();
  const symDirBuckets = new Map<string, any[]>();

  for (const t of filteredPool) {
    const kz = classifyKillzoneAnd7hCandle(t.openedAt);
    const kzKey = kz.label || "Other";
    kzBuckets.set(kzKey, [...(kzBuckets.get(kzKey) ?? []), t]);

    const c7Key = kz.candle7h || "Other";
    candle7hBuckets.set(c7Key, [...(candle7hBuckets.get(c7Key) ?? []), t]);

    const dIdx = new Date(t.openedAt).getUTCDay();
    const dName = DAY_NAMES[dIdx] || "Monday";
    dowBuckets.set(dName, [...(dowBuckets.get(dName) ?? []), t]);

    const sym = String(t.symbol || "UNKNOWN").replace(/\.raw$/i, "");
    symbolBuckets.set(sym, [...(symbolBuckets.get(sym) ?? []), t]);

    const dirUpper = String(t.direction || "long").toUpperCase();
    const sdKey = `${sym} · ${dirUpper}`;
    symDirBuckets.set(sdKey, [...(symDirBuckets.get(sdKey) ?? []), t]);
  }

  const formatMapBuckets = (map: Map<string, any[]>) =>
    Array.from(map.entries())
      .map(([label, list]) => ({
        key: label,
        label,
        metrics: computeQuantBucketMetrics(list),
        optimalTargetR: computeMfeTargetCurve(list).bestTrailing?.targetR ?? null,
        trades: list,
      }))
      .sort((a, b) => b.metrics.expectancyR - a.metrics.expectancyR);

  // Hold-Time Duration Buckets
  const byDuration = DURATION_BUCKETS.map((b) => {
    const matched = filteredPool.filter((t) => {
      const dur = getTradeDurationMs(t);
      return dur !== null && dur >= b.min && dur < b.max;
    });
    return {
      key: b.key,
      label: b.label,
      metrics: computeQuantBucketMetrics(matched),
      optimalTargetR: computeMfeTargetCurve(matched).bestTrailing?.targetR ?? null,
      trades: matched,
    };
  }).filter((r) => r.metrics.count > 0);

  // Sequential State Buckets (Post-Win vs Post-Loss)
  const bySequentialState = computeSequentialStateBuckets(filteredPool);

  // Automated Pattern Scanner: Single Factors (Tags, Rules, Killzones, Durations, SymbolxDir)
  const singleFactors: Array<{
    id: string;
    kind: "tag" | "rule" | "killzone" | "duration" | "sym_dir";
    label: string;
    groupLabel: string;
    metrics: ReturnType<typeof computeQuantBucketMetrics>;
    expectancyLiftR: number;
    winRateLift: number;
    optimalTargetR: number | null;
  }> = [];

  for (const mt of managedTagsList) {
    const target = mt.name.toLowerCase();
    const matched = filteredPool.filter((t) => getTradeTagsLower(t).includes(target));
    if (matched.length === 0) continue;
    const m = computeQuantBucketMetrics(matched);
    singleFactors.push({
      id: `tag:${mt.name}`,
      kind: "tag",
      label: mt.name,
      groupLabel: mt.categoryName,
      metrics: m,
      expectancyLiftR: Number((m.expectancyR - baseline.expectancyR).toFixed(2)),
      winRateLift: Number((m.winRate - baseline.winRate).toFixed(1)),
      optimalTargetR: computeMfeTargetCurve(matched).bestTrailing?.targetR ?? null,
    });
  }

  for (const pb of allPlaybooks) {
    if (selectedStrategyId !== "all" && pb.id !== selectedStrategyId) continue;
    const meta = getMetaRow(pb.id);
    const ruleGroups = normalizeRuleGroups(meta?.rule_groups_json, pb.rulesJson);
    for (const grp of ruleGroups) {
      for (const r of grp.rules) {
        const rk = `${pb.id}::${r.text.trim()}`;
        const matched = filteredPool.filter((t) => {
          const tk = String(t.key ?? t.id ?? "");
          return Boolean(ruleMapByTrade.get(tk)?.has(rk));
        });
        if (matched.length === 0) continue;
        const m = computeQuantBucketMetrics(matched);
        singleFactors.push({
          id: `rule:${rk}`,
          kind: "rule",
          label: r.text.trim(),
          groupLabel: `${pb.name} • ${grp.name}`,
          metrics: m,
          expectancyLiftR: Number((m.expectancyR - baseline.expectancyR).toFixed(2)),
          winRateLift: Number((m.winRate - baseline.winRate).toFixed(1)),
          optimalTargetR: computeMfeTargetCurve(matched).bestTrailing?.targetR ?? null,
        });
      }
    }
  }

  for (const [kzLabel, kzList] of kzBuckets.entries()) {
    if (kzList.length === 0) continue;
    const m = computeQuantBucketMetrics(kzList);
    singleFactors.push({
      id: `kz:${kzLabel}`,
      kind: "killzone",
      label: kzLabel,
      groupLabel: "ICT Killzone / Session",
      metrics: m,
      expectancyLiftR: Number((m.expectancyR - baseline.expectancyR).toFixed(2)),
      winRateLift: Number((m.winRate - baseline.winRate).toFixed(1)),
      optimalTargetR: computeMfeTargetCurve(kzList).bestTrailing?.targetR ?? null,
    });
  }

  for (const dRow of byDuration) {
    singleFactors.push({
      id: `dur:${dRow.key}`,
      kind: "duration",
      label: `Hold Time: ${dRow.label}`,
      groupLabel: "Trade Duration",
      metrics: dRow.metrics,
      expectancyLiftR: Number((dRow.metrics.expectancyR - baseline.expectancyR).toFixed(2)),
      winRateLift: Number((dRow.metrics.winRate - baseline.winRate).toFixed(1)),
      optimalTargetR: dRow.optimalTargetR,
    });
  }

  for (const [sdLabel, sdList] of symDirBuckets.entries()) {
    if (sdList.length === 0) continue;
    const m = computeQuantBucketMetrics(sdList);
    singleFactors.push({
      id: `sd:${sdLabel}`,
      kind: "sym_dir",
      label: sdLabel,
      groupLabel: "Symbol × Direction",
      metrics: m,
      expectancyLiftR: Number((m.expectancyR - baseline.expectancyR).toFixed(2)),
      winRateLift: Number((m.winRate - baseline.winRate).toFixed(1)),
      optimalTargetR: computeMfeTargetCurve(sdList).bestTrailing?.targetR ?? null,
    });
  }

  const edgeAmplifiers = [...singleFactors]
    .filter((f) => f.metrics.expectancyR > 0)
    .sort((a, b) => b.metrics.expectancyR - a.metrics.expectancyR || b.metrics.totalR - a.metrics.totalR)
    .slice(0, 10);

  const drawdownLeaks = [...singleFactors]
    .filter((f) => f.metrics.expectancyR < 0 || f.metrics.totalR < 0)
    .sort((a, b) => a.metrics.totalR - b.metrics.totalR || a.metrics.expectancyR - b.metrics.expectancyR)
    .slice(0, 10);

  // 2-Factor Confluence Synergy Scanner
  const activeTags = managedTagsList.filter((mt) =>
    filteredPool.some((t) => getTradeTagsLower(t).includes(mt.name.toLowerCase()))
  );
  const confluencePairs: Array<{
    id: string;
    label: string;
    categoriesLabel: string;
    metrics: ReturnType<typeof computeQuantBucketMetrics>;
    expectancyLiftR: number;
  }> = [];

  for (let i = 0; i < activeTags.length; i++) {
    for (let j = i + 1; j < activeTags.length; j++) {
      const t1 = activeTags[i]!;
      const t2 = activeTags[j]!;
      const l1 = t1.name.toLowerCase();
      const l2 = t2.name.toLowerCase();
      const both = filteredPool.filter((tr) => {
        const toks = getTradeTagsLower(tr);
        return toks.includes(l1) && toks.includes(l2);
      });
      if (both.length === 0) continue;
      const m = computeQuantBucketMetrics(both);
      confluencePairs.push({
        id: `${t1.id}+${t2.id}`,
        label: `${t1.name} + ${t2.name}`,
        categoriesLabel: `${t1.categoryName} × ${t2.categoryName}`,
        metrics: m,
        expectancyLiftR: Number((m.expectancyR - baseline.expectancyR).toFixed(2)),
      });
    }
  }
  confluencePairs.sort((a, b) => b.metrics.expectancyR - a.metrics.expectancyR);

  // Hesitation Tax Scanner
  const allCombinedWithMissed =
    selectedStrategyId === "all"
      ? [...closedExec, ...missedBundle.trades]
      : [...closedExec, ...missedBundle.trades].filter(
          (t: any) =>
            (t.playbookId ?? t.annotations?.playbook) === selectedStrategyId
        );

  const hesitationTaxList = managedTagsList
    .map((mt) => {
      const target = mt.name.toLowerCase();
      const allForTag = allCombinedWithMissed.filter((t) =>
        getTradeTagsLower(t).includes(target)
      );
      const missedForTag = allForTag.filter((t) => Boolean(t.isMissed));
      const execForTag = allForTag.filter((t) => !t.isMissed);
      if (missedForTag.length === 0) return null;
      const missedStats = computeQuantBucketMetrics(missedForTag);
      const execStats = computeQuantBucketMetrics(execForTag);
      return {
        tag: mt.name,
        categoryName: mt.categoryName,
        missedCount: missedForTag.length,
        executedCount: execForTag.length,
        hesitationRatePct: Number(
          ((missedForTag.length / allForTag.length) * 100).toFixed(0)
        ),
        missedTotalR: missedStats.totalR,
        missedExpectancyR: missedStats.expectancyR,
        missedPnl: missedStats.netPnl,
        executedTotalR: execStats.totalR,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.missedTotalR - a.missedTotalR);

  return ok({
    playbooks: allPlaybooks.map((p) => ({
      id: p.id,
      name: p.name,
      icon: getMetaRow(p.id)?.icon ?? "🚀",
    })),
    tagCategories: tagCategoriesList,
    baseline,
    mfeCurve,
    partialGrid,
    maeSimulator,
    dimensions: {
      byCategory,
      byKillzone: formatMapBuckets(kzBuckets),
      by7hCandle: formatMapBuckets(candle7hBuckets),
      byDuration,
      bySequentialState,
      bySymbolDirection: formatMapBuckets(symDirBuckets),
      byDayOfWeek: formatMapBuckets(dowBuckets),
      bySymbol: formatMapBuckets(symbolBuckets),
    },
    edgeAmplifiers,
    drawdownLeaks,
    confluencePairs: confluencePairs.slice(0, 8),
    hesitationTax: hesitationTaxList.slice(0, 8),
  });
});

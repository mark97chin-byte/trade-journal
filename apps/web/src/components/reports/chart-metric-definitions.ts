export type MetricCategory =
  | "Time Analysis"
  | "Profitability"
  | "Risk & Drawdown"
  | "Trading Activity & Volume"
  | "Streaks & Consistency";

export type ValueFormat = "money" | "percent" | "number" | "duration" | "ratio";

export interface MetricDef {
  key: string;
  label: string;
  category: MetricCategory;
  format: ValueFormat;
  defaultChartType: "bar" | "line" | "area";
  defaultColor: string;
}

export const METRIC_DEFINITIONS: MetricDef[] = [
  // --- Time Analysis ---
  {
    key: "avgHoldTimeCumulative",
    label: "Avg hold time - cumulative",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "line",
    defaultColor: "#3b82f6",
  },
  {
    key: "avgTradingWeeksDuration",
    label: "Average trading weeks duration",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "avgTradingDaysDuration",
    label: "Average trading days duration",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "avgHoldTime",
    label: "Avg hold time",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "longestTradeDuration",
    label: "Longest trade duration",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "#8b5cf6",
  },

  // --- Profitability ---
  {
    key: "netPnl",
    label: "Net P&L",
    category: "Profitability",
    format: "money",
    defaultChartType: "area",
    defaultColor: "#ef4444",
  },
  {
    key: "cumulativeNetPnl",
    label: "Cumulative net P&L",
    category: "Profitability",
    format: "money",
    defaultChartType: "line",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "avgDailyNetPnl",
    label: "Avg daily net P&L",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "avgDailyWinLoss",
    label: "Avg daily win/loss",
    category: "Profitability",
    format: "ratio",
    defaultChartType: "line",
    defaultColor: "#3b82f6",
  },
  {
    key: "avgLoss",
    label: "Avg loss",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "avgWin",
    label: "Avg win",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "avgNetTradePnl",
    label: "Avg net trade P&L",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "avgTradeWinLoss",
    label: "Avg trade win/loss",
    category: "Profitability",
    format: "ratio",
    defaultChartType: "line",
    defaultColor: "#3b82f6",
  },
  {
    key: "profitFactor",
    label: "Profit factor",
    category: "Profitability",
    format: "ratio",
    defaultChartType: "line",
    defaultColor: "#3b82f6",
  },
  {
    key: "tradeExpectancy",
    label: "Trade expectancy",
    category: "Profitability",
    format: "money",
    defaultChartType: "line",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "largestProfitableTrade",
    label: "Largest profitable trade",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "largestLosingTrade",
    label: "Largest losing trade",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },

  // --- Risk & Drawdown ---
  {
    key: "avgDailyNetDrawdown",
    label: "Avg daily net drawdown",
    category: "Risk & Drawdown",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "maxDailyNetDrawdown",
    label: "Max daily net drawdown",
    category: "Risk & Drawdown",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "avgPlannedR",
    label: "Avg. planned r-multiple",
    category: "Risk & Drawdown",
    format: "ratio",
    defaultChartType: "line",
    defaultColor: "#8b5cf6",
  },
  {
    key: "avgRealizedR",
    label: "Avg. realized r-multiple",
    category: "Risk & Drawdown",
    format: "ratio",
    defaultChartType: "line",
    defaultColor: "#8b5cf6",
  },

  // --- Trading Activity & Volume ---
  {
    key: "tradeCount",
    label: "Trade count",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "line",
    defaultColor: "#3b82f6",
  },
  {
    key: "avgDailyVolume",
    label: "Avg daily volume",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#3b82f6",
  },
  {
    key: "volume",
    label: "Volume",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#3b82f6",
  },
  {
    key: "longsTrades",
    label: "Longs # of trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#3b82f6",
  },
  {
    key: "shortsTrades",
    label: "Shorts # of trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#3b82f6",
  },

  // --- Streaks & Consistency ---
  {
    key: "winRate",
    label: "Win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "longsWinPct",
    label: "Longs win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "shortsWinPct",
    label: "Shorts win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
  {
    key: "avgDailyWinPct",
    label: "Avg daily win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "var(--profit-fill, #0ca30c)",
  },
];

export const CATEGORIES: MetricCategory[] = [
  "Time Analysis",
  "Profitability",
  "Risk & Drawdown",
  "Trading Activity & Volume",
  "Streaks & Consistency",
];

export function computeBucketValue(
  metricKey: string,
  bucketTrades: any[],
  allTradesUpToBucket?: any[]
): number {
  const currentTrades = bucketTrades || [];
  const cumulativeTrades = allTradesUpToBucket || currentTrades;
  const count = currentTrades.length;

  const wins = currentTrades.filter(
    (t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001 || t.status === "win"
  );
  const losses = currentTrades.filter(
    (t) => Number(t.netPnl ?? t.pnl ?? 0) < -0.0001 || t.status === "loss"
  );

  const totalPnl = currentTrades.reduce(
    (sum, t) => sum + Number(t.netPnl ?? t.pnl ?? 0),
    0
  );
  const grossProfit = wins.reduce(
    (sum, t) => sum + Number(t.netPnl ?? t.pnl ?? 0),
    0
  );
  const grossLoss = losses.reduce(
    (sum, t) => sum + Math.abs(Number(t.netPnl ?? t.pnl ?? 0)),
    0
  );

  const longs = currentTrades.filter((t) =>
    String(t.direction ?? "").toLowerCase().includes("long")
  );
  const shorts = currentTrades.filter((t) =>
    String(t.direction ?? "").toLowerCase().includes("short")
  );

  switch (metricKey) {
    case "avgHoldTimeCumulative": {
      let durSum = 0;
      let durCount = 0;
      for (const t of cumulativeTrades) {
        if (t.openedAt && (t.closedAt ?? t.closeTime ?? t.exitTime)) {
          durSum +=
            new Date(t.closedAt ?? t.closeTime ?? t.exitTime).getTime() -
            new Date(t.openedAt).getTime();
          durCount++;
        }
      }
      return durCount > 0 ? Math.round(durSum / durCount / 60000) : 0;
    }

    case "cumulativeNetPnl":
      return cumulativeTrades.reduce(
        (sum, t) => sum + Number(t.netPnl ?? t.pnl ?? 0),
        0
      );

    case "avgTradingWeeksDuration":
    case "avgTradingDaysDuration":
    case "avgHoldTime": {
      let durSum = 0;
      let durCount = 0;
      for (const t of currentTrades) {
        if (t.openedAt && (t.closedAt ?? t.closeTime ?? t.exitTime)) {
          durSum +=
            new Date(t.closedAt ?? t.closeTime ?? t.exitTime).getTime() -
            new Date(t.openedAt).getTime();
          durCount++;
        }
      }
      return durCount > 0 ? Math.round(durSum / durCount / 60000) : 0;
    }

    case "longestTradeDuration": {
      let maxDur = 0;
      for (const t of currentTrades) {
        if (t.openedAt && (t.closedAt ?? t.closeTime ?? t.exitTime)) {
          const d =
            new Date(t.closedAt ?? t.closeTime ?? t.exitTime).getTime() -
            new Date(t.openedAt).getTime();
          if (d > maxDur) maxDur = d;
        }
      }
      return Math.round(maxDur / 60000);
    }

    case "winRate":
      return count > 0 ? (wins.length / count) * 100 : 0;

    case "netPnl":
      return totalPnl;

    case "tradeCount":
      return count;

    case "volume":
    case "avgDailyVolume":
      return currentTrades.reduce(
        (sum, t) => sum + Number(t.quantity ?? t.volume ?? 0),
        0
      );

    case "avgNetTradePnl":
    case "avgDailyNetPnl":
      return count > 0 ? totalPnl / count : 0;

    case "avgWin":
      return wins.length > 0 ? grossProfit / wins.length : 0;

    case "avgLoss":
      return losses.length > 0 ? -(grossLoss / losses.length) : 0;

    case "largestProfitableTrade":
      return wins.length > 0
        ? Math.max(...wins.map((t) => Number(t.netPnl ?? t.pnl ?? 0)))
        : 0;

    case "largestLosingTrade":
      return losses.length > 0
        ? Math.min(...losses.map((t) => Number(t.netPnl ?? t.pnl ?? 0)))
        : 0;

    case "profitFactor":
      return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

    case "tradeExpectancy": {
      const wr = count > 0 ? wins.length / count : 0;
      const lr = count > 0 ? losses.length / count : 0;
      const aw = wins.length > 0 ? grossProfit / wins.length : 0;
      const al = losses.length > 0 ? grossLoss / losses.length : 0;
      return wr * aw - lr * al;
    }

    case "longsTrades":
      return longs.length;

    case "shortsTrades":
      return shorts.length;

    case "longsWinPct": {
      const lWins = longs.filter(
        (t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001
      ).length;
      return longs.length > 0 ? (lWins / longs.length) * 100 : 0;
    }

    case "shortsWinPct": {
      const sWins = shorts.filter(
        (t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001
      ).length;
      return shorts.length > 0 ? (sWins / shorts.length) * 100 : 0;
    }

    case "avgPlannedR": {
      const rs = currentTrades.filter((t) => typeof t.plannedR === "number");
      return rs.length > 0
        ? rs.reduce((sum, t) => sum + t.plannedR, 0) / rs.length
        : 0;
    }

    case "avgRealizedR": {
      const rs = currentTrades.filter((t) => typeof t.realizedR === "number");
      return rs.length > 0
        ? rs.reduce((sum, t) => sum + t.realizedR, 0) / rs.length
        : 0;
    }

    default:
      return totalPnl;
  }
}

export function formatMetricDisplay(val: number, format: ValueFormat): string {
  if (isNaN(val)) return "-";
  switch (format) {
    case "money": {
      const abs = Math.abs(val);
      const sign = val < 0 ? "-$" : "$";
      if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
      return `${sign}${abs.toFixed(0)}`;
    }
    case "percent":
      return `${val.toFixed(0)}%`;
    case "duration": {
      if (val <= 0) return "0";
      const totalMin = Math.round(val);
      const d = Math.floor(totalMin / 1440);
      const h = Math.floor((totalMin % 1440) / 60);
      const m = totalMin % 60;
      const parts = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0) parts.push(`${h}h`);
      if (m > 0 || parts.length === 0) parts.push(`${m}m`);
      return parts.join(" ");
    }
    case "ratio":
      return val.toFixed(2);
    case "number":
    default:
      return Number.isInteger(val) ? String(val) : val.toFixed(1);
  }
}

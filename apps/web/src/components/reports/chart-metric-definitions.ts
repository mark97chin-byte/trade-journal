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
    key: "avgTradingDaysDuration",
    label: "Average trading days duration",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "avgHoldTime",
    label: "Avg hold time",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "longestTradeDuration",
    label: "Longest trade duration",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "#8b5cf6",
  },
  {
    key: "maxTradingDaysDuration",
    label: "Max trading days duration",
    category: "Time Analysis",
    format: "duration",
    defaultChartType: "bar",
    defaultColor: "#8b5cf6",
  },

  // --- Profitability ---
  {
    key: "avgDailyNetPnl",
    label: "Avg daily net P&L",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#10b981",
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
    key: "avgMaxTradeLoss",
    label: "Avg max trade loss",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "avgMaxTradeProfit",
    label: "Avg max trade profit",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "avgNetTradePnl",
    label: "Avg net trade P&L",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#10b981",
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
    key: "avgWin",
    label: "Avg win",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "largestLosingTrade",
    label: "Largest losing trade",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "largestProfitableTrade",
    label: "Largest profitable trade",
    category: "Profitability",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "netPnl",
    label: "Net P&L",
    category: "Profitability",
    format: "money",
    defaultChartType: "area",
    defaultColor: "#ef4444",
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
    defaultColor: "#10b981",
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
  {
    key: "breakevenDays",
    label: "Breakeven days",
    category: "Risk & Drawdown",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#64748b",
  },
  {
    key: "breakevenTrades",
    label: "Breakeven trades",
    category: "Risk & Drawdown",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#64748b",
  },
  {
    key: "losingDays",
    label: "Losing days",
    category: "Risk & Drawdown",
    format: "number",
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

  // --- Trading Activity & Volume ---
  {
    key: "avgDailyVolume",
    label: "Avg daily volume",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#3b82f6",
  },
  {
    key: "dailyNetDrawdown",
    label: "Daily net drawdown",
    category: "Trading Activity & Volume",
    format: "money",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "loggedDays",
    label: "Logged days",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#3b82f6",
  },
  {
    key: "longsBreakevenTrades",
    label: "Longs # of breakeven trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#64748b",
  },
  {
    key: "longsLosingTrades",
    label: "Longs # of losing trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "longsOpenTrades",
    label: "Longs # of open trades",
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
    key: "longsWinningTrades",
    label: "Longs # of winning trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "lossTrades",
    label: "Loss # of trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "netAccountBalance",
    label: "Net account balance",
    category: "Trading Activity & Volume",
    format: "money",
    defaultChartType: "line",
    defaultColor: "#10b981",
  },
  {
    key: "openTrades",
    label: "Open trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#3b82f6",
  },
  {
    key: "shortsBreakevenTrades",
    label: "Shorts # of breakeven trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#64748b",
  },
  {
    key: "shortsLosingTrades",
    label: "Shorts # of losing trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "shortsOpenTrades",
    label: "Shorts # of open trades",
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
  {
    key: "shortsWinningTrades",
    label: "Shorts # of winning trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "tradeCount",
    label: "Trade count",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "line",
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
    key: "winTrades",
    label: "Win # of trades",
    category: "Trading Activity & Volume",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },

  // --- Streaks & Consistency ---
  {
    key: "avgDailyWinPct",
    label: "Avg daily win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "longsWinPct",
    label: "Longs win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "maxConsecLosingDays",
    label: "Max consecutive losing days",
    category: "Streaks & Consistency",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "maxConsecLosses",
    label: "Max consecutive losses",
    category: "Streaks & Consistency",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#ef4444",
  },
  {
    key: "maxConsecWinningDays",
    label: "Max consecutive winning days",
    category: "Streaks & Consistency",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "maxConsecWins",
    label: "Max consecutive wins",
    category: "Streaks & Consistency",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "sharpeRatio",
    label: "Sharpe ratio",
    category: "Streaks & Consistency",
    format: "ratio",
    defaultChartType: "line",
    defaultColor: "#8b5cf6",
  },
  {
    key: "shortsWinPct",
    label: "Shorts win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "sortinoRatio",
    label: "Sortino ratio",
    category: "Streaks & Consistency",
    format: "ratio",
    defaultChartType: "line",
    defaultColor: "#8b5cf6",
  },
  {
    key: "winRate",
    label: "Win %",
    category: "Streaks & Consistency",
    format: "percent",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
  {
    key: "winningDays",
    label: "Winning days",
    category: "Streaks & Consistency",
    format: "number",
    defaultChartType: "bar",
    defaultColor: "#10b981",
  },
];

export const CATEGORIES: MetricCategory[] = [
  "Time Analysis",
  "Profitability",
  "Risk & Drawdown",
  "Trading Activity & Volume",
  "Streaks & Consistency",
];

export function computeBucketValue(metricKey: string, bucketTrades: any[]): number {
  if (!bucketTrades || bucketTrades.length === 0) return 0;

  const count = bucketTrades.length;
  const wins = bucketTrades.filter((t) => (Number(t.netPnl ?? t.pnl ?? 0) > 0.0001) || t.status === "win");
  const losses = bucketTrades.filter((t) => (Number(t.netPnl ?? t.pnl ?? 0) < -0.0001) || t.status === "loss");
  const bes = bucketTrades.filter((t) => Math.abs(Number(t.netPnl ?? t.pnl ?? 0)) <= 0.0001);

  const totalPnl = bucketTrades.reduce((sum, t) => sum + Number(t.netPnl ?? t.pnl ?? 0), 0);
  const grossProfit = wins.reduce((sum, t) => sum + Number(t.netPnl ?? t.pnl ?? 0), 0);
  const grossLoss = losses.reduce((sum, t) => sum + Math.abs(Number(t.netPnl ?? t.pnl ?? 0)), 0);

  const longs = bucketTrades.filter((t) => String(t.direction ?? "").toLowerCase().includes("long"));
  const shorts = bucketTrades.filter((t) => String(t.direction ?? "").toLowerCase().includes("short"));

  switch (metricKey) {
    case "winRate":
      return count > 0 ? (wins.length / count) * 100 : 0;
    case "netPnl":
      return totalPnl;
    case "tradeCount":
      return count;
    case "volume":
      return bucketTrades.reduce((sum, t) => sum + Number(t.quantity ?? t.volume ?? 0), 0);
    case "avgDailyVolume":
      return count > 0 ? bucketTrades.reduce((sum, t) => sum + Number(t.quantity ?? t.volume ?? 0), 0) / count : 0;
    case "avgNetTradePnl":
    case "avgDailyNetPnl":
      return count > 0 ? totalPnl / count : 0;
    case "avgWin":
      return wins.length > 0 ? grossProfit / wins.length : 0;
    case "avgLoss":
      return losses.length > 0 ? -(grossLoss / losses.length) : 0;
    case "largestProfitableTrade":
      return wins.length > 0 ? Math.max(...wins.map((t) => Number(t.netPnl ?? t.pnl ?? 0))) : 0;
    case "largestLosingTrade":
      return losses.length > 0 ? Math.min(...losses.map((t) => Number(t.netPnl ?? t.pnl ?? 0))) : 0;
    case "profitFactor":
      return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
    case "tradeExpectancy": {
      const wr = count > 0 ? wins.length / count : 0;
      const lr = count > 0 ? losses.length / count : 0;
      const aw = wins.length > 0 ? grossProfit / wins.length : 0;
      const al = losses.length > 0 ? grossLoss / losses.length : 0;
      return wr * aw - lr * al;
    }
    case "winTrades":
      return wins.length;
    case "lossTrades":
      return losses.length;
    case "breakevenTrades":
      return bes.length;
    case "longsTrades":
      return longs.length;
    case "shortsTrades":
      return shorts.length;
    case "longsWinningTrades":
      return longs.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001).length;
    case "shortsWinningTrades":
      return shorts.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001).length;
    case "longsWinPct":
      return longs.length > 0 ? (longs.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001).length / longs.length) * 100 : 0;
    case "shortsWinPct":
      return shorts.length > 0 ? (shorts.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001).length / shorts.length) * 100 : 0;
    case "avgPlannedR": {
      const rs = bucketTrades.filter((t) => typeof t.plannedR === "number");
      return rs.length > 0 ? rs.reduce((sum, t) => sum + t.plannedR, 0) / rs.length : 0;
    }
    case "avgRealizedR": {
      const rs = bucketTrades.filter((t) => typeof t.realizedR === "number");
      return rs.length > 0 ? rs.reduce((sum, t) => sum + t.realizedR, 0) / rs.length : 0;
    }
    case "avgHoldTime": {
      let durSum = 0;
      let durCount = 0;
      for (const t of bucketTrades) {
        if (t.openedAt && (t.closedAt ?? t.closeTime)) {
          durSum += new Date(t.closedAt ?? t.closeTime).getTime() - new Date(t.openedAt).getTime();
          durCount++;
        }
      }
      return durCount > 0 ? Math.round(durSum / durCount / 60000) : 0; // minutes
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
    case "duration":
      return `${val}m`;
    case "ratio":
      return val.toFixed(2);
    case "number":
    default:
      return Number.isInteger(val) ? String(val) : val.toFixed(1);
  }
}

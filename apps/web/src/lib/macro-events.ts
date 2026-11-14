// Official US High-Impact Macro Calendar (CPI, NFP, FOMC) & US Bank Holidays (2025-2027)

// US CPI Release Dates (Bureau of Labor Statistics, 08:30 ET)
export const CPI_DATES = new Set<string>([
  // 2025
  "2025-01-15", "2025-02-12", "2025-03-12", "2025-04-10", "2025-05-13", "2025-06-11",
  "2025-07-15", "2025-08-12", "2025-09-10", "2025-10-15", "2025-11-13", "2025-12-10",
  // 2026
  "2026-01-13", "2026-02-11", "2026-03-11", "2026-04-14", "2026-05-12", "2026-06-10",
  "2026-07-14", "2026-08-12", "2026-09-11", "2026-10-14", "2026-11-12", "2026-12-10",
  // 2027
  "2027-01-13", "2027-02-10", "2027-03-10", "2027-04-13", "2027-05-12", "2027-06-10",
  "2027-07-14", "2027-08-11", "2027-09-14", "2027-10-13", "2027-11-10", "2027-12-14",
]);

// Federal Reserve FOMC Rate Decision & Press Statement Dates (14:00 ET)
export const FOMC_DATES = new Set<string>([
  // 2025
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
  "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  // 2026
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  // 2027
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
  "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
]);

// US Non-Farm Payrolls (NFP) Release Dates (First Friday of Month, plus known holiday shifts)
export const NFP_EXPLICIT_DATES = new Set<string>([
  // 2025
  "2025-01-10", "2025-02-07", "2025-03-07", "2025-04-04", "2025-05-02", "2025-06-06",
  "2025-07-03", "2025-08-01", "2025-09-05", "2025-10-03", "2025-11-07", "2025-12-05",
  // 2026
  "2026-01-09", "2026-02-06", "2026-03-06", "2026-04-03", "2026-05-08", "2026-06-05",
  "2026-07-02", "2026-08-07", "2026-09-04", "2026-10-02", "2026-11-06", "2026-12-04",
  // 2027
  "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04",
  "2027-07-02", "2027-08-06", "2027-09-03", "2027-10-01", "2027-11-05", "2027-12-03",
]);

// US Market / Bank Holidays (NYSE / CME Reduced Liquidity or Closed Days)
export const US_BANK_HOLIDAYS = new Set<string>([
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-10-13", "2025-11-11", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
]);

function toNyDateString(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {}
  return String(isoStr).slice(0, 10);
}

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function isNfpDate(dateIso: string): boolean {
  if (NFP_EXPLICIT_DATES.has(dateIso)) return true;
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  // Fallback for any year outside 2025-2027: First Friday of the month
  return d.getUTCDay() === 5 && d.getUTCDate() <= 7 && !NFP_EXPLICIT_DATES.has(addDaysIso(dateIso, 7));
}

function getWeekDatesMonToFri(dateIso: string): {
  monday: string;
  days: string[];
  dayOfWeek: number; // 1 = Mon ... 5 = Fri
} {
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  const dow = d.getUTCDay() || 7;
  const mon = new Date(d.getTime() - (dow - 1) * 86_400_000);
  const monIso = mon.toISOString().slice(0, 10);
  const days = [0, 1, 2, 3, 4].map((offset) => addDaysIso(monIso, offset));
  return { monday: monIso, days, dayOfWeek: dow };
}

export interface TradeMacroClassifications {
  nyDate: string;
  buckets: string[];
}

export function classifyTradeMacroEvents(openedAtIso: string): TradeMacroClassifications {
  const nyDate = toNyDateString(openedAtIso);
  const nextTradingDay = (() => {
    const d = new Date(`${nyDate}T12:00:00Z`);
    const dow = d.getUTCDay();
    // If Friday (5), next trading day is Monday (+3); otherwise +1
    return addDaysIso(nyDate, dow === 5 ? 3 : 1);
  })();

  const { days: weekDays, dayOfWeek } = getWeekDatesMonToFri(nyDate);
  const buckets: string[] = [];

  // 1. Exact Release Day (T-0)
  const isCpiDay = CPI_DATES.has(nyDate);
  const isFomcDay = FOMC_DATES.has(nyDate);
  const isNfpDay = isNfpDate(nyDate);
  const isHoliday = US_BANK_HOLIDAYS.has(nyDate);

  if (isCpiDay) buckets.push("T-0 Release Day: CPI Day (Post-Release)");
  if (isNfpDay) buckets.push("T-0 Release Day: NFP Friday (Post-Release)");
  if (isFomcDay) buckets.push("T-0 Release Day: FOMC Statement Day");
  if (isHoliday) buckets.push("T-0 Holiday: US Bank Holiday Session");

  if (!isCpiDay && !isNfpDay && !isFomcDay && !isHoliday) {
    buckets.push("Baseline: Normal Non-Event Trading Day");
  }

  // 2. 1 Day Before News / Holiday (T-1 Pre-Event Day)
  if (CPI_DATES.has(nextTradingDay) || CPI_DATES.has(addDaysIso(nyDate, 1))) {
    buckets.push("T-1 Pre-News: 1 Day Before CPI");
  }
  if (isNfpDate(nextTradingDay) || isNfpDate(addDaysIso(nyDate, 1))) {
    buckets.push("T-1 Pre-News: 1 Day Before NFP (Thursday)");
  }
  if (FOMC_DATES.has(nextTradingDay) || FOMC_DATES.has(addDaysIso(nyDate, 1))) {
    buckets.push("T-1 Pre-News: 1 Day Before FOMC");
  }
  if (US_BANK_HOLIDAYS.has(nextTradingDay) || US_BANK_HOLIDAYS.has(addDaysIso(nyDate, 1))) {
    buckets.push("T-1 Pre-Holiday: 1 Day Before US Bank Holiday");
  }

  // 3. Weekly Perspective: CPI Week (Pre-CPI Days vs Post-CPI Days)
  const cpiInWeek = weekDays.find((wd) => CPI_DATES.has(wd));
  if (cpiInWeek) {
    if (nyDate < cpiInWeek) {
      buckets.push("CPI Week: Pre-CPI Days (Ahead of Release)");
    } else if (nyDate > cpiInWeek) {
      buckets.push("CPI Week: Post-CPI Days (After Release)");
    }
  }

  // 4. Weekly Perspective: FOMC Week (Pre-FOMC Days vs Post-FOMC Days)
  const fomcInWeek = weekDays.find((wd) => FOMC_DATES.has(wd));
  if (fomcInWeek) {
    if (nyDate < fomcInWeek) {
      buckets.push("FOMC Week: Pre-FOMC Days (Mon–Tue Ahead of Fed)");
    } else if (nyDate > fomcInWeek) {
      buckets.push("FOMC Week: Post-FOMC Days (Thu–Fri After Fed)");
    }
  }

  // 5. NFP Week Split: Monday–Wednesday vs Thursday–Friday
  const nfpInWeek = weekDays.find((wd) => isNfpDate(wd));
  if (nfpInWeek) {
    if (dayOfWeek >= 1 && dayOfWeek <= 3) {
      buckets.push("NFP Week: Monday – Wednesday (Early Week)");
    } else if (dayOfWeek === 4 || dayOfWeek === 5) {
      buckets.push("NFP Week: Thursday – Friday (Late Week)");
    }
  }

  // 6. Bank Holiday Week Perspective
  const holidayInWeek = weekDays.find((wd) => US_BANK_HOLIDAYS.has(wd));
  if (holidayInWeek && nyDate !== holidayInWeek) {
    if (nyDate < holidayInWeek) {
      buckets.push("Holiday Week: Pre-Holiday Days in Week");
    } else {
      buckets.push("Holiday Week: Post-Holiday Days in Week");
    }
  }

  return { nyDate, buckets };
}

export function classifyOvernightAndSessionHold(trade: any): {
  isOvernight: boolean;
  overnightBucket: string;
  cushionBucket: string | null;
  peakOrCushionR: number;
} {
  const openIso = String(trade.openedAt || "");
  const closeIso = String(trade.closedAt || trade.closeTime || trade.exitTime || openIso);
  const openDayNy = toNyDateString(openIso);
  const closeDayNy = toNyDateString(closeIso);

  const openMs = Date.parse(openIso);
  const closeMs = Date.parse(closeIso);
  const durHours =
    Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs > openMs
      ? (closeMs - openMs) / 3_600_000
      : 0;

  // A trade is held overnight if it closes on a later NY calendar day OR is held > 8 hours across sessions
  const isOvernight = (openDayNy !== "" && closeDayNy !== "" && closeDayNy > openDayNy) || durHours >= 8;

  const actualR =
    typeof trade.realizedR === "number" && Number.isFinite(trade.realizedR)
      ? trade.realizedR
      : Number(trade.netPnl ?? 0) > 0
      ? 1
      : -1;
  const mfeR =
    typeof trade.mfeR === "number" && Number.isFinite(trade.mfeR)
      ? Math.max(trade.mfeR, Math.max(0, actualR))
      : Math.max(0, actualR);

  if (!isOvernight) {
    return {
      isOvernight: false,
      overnightBucket: "Intraday Close (Closed Same NY Day)",
      cushionBucket: null,
      peakOrCushionR: mfeR,
    };
  }

  let cushionBucket = "Overnight Hold · Small / Near-BE Cushion (< +0.75R MFE)";
  if (mfeR >= 1.5) {
    cushionBucket = "Overnight Hold · Strong Profit Cushion (≥ +1.50R MFE)";
  } else if (mfeR >= 0.75) {
    cushionBucket = "Overnight Hold · Moderate Cushion (+0.75R to +1.49R MFE)";
  }

  return {
    isOvernight: true,
    overnightBucket: "Held Overnight (Crossed NY Session Close / >8h)",
    cushionBucket,
    peakOrCushionR: mfeR,
  };
}

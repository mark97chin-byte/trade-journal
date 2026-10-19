import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface CalendarEvent {
  id: string;
  date: string;
  time: string;
  timestampIso: string;
  country: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  title: string;
  forecast: string;
  previous: string;
  actual: string;
}

const memoryCache = new Map<string, { timestamp: number; events: CalendarEvent[] }>();

interface CanonicalMapping {
  title: string;
  impact: "High" | "Medium" | "Low";
  requiresForecast?: boolean;
}

const EXACT_TV_TO_FF_MAP: Record<string, CanonicalMapping> = {
  // Inflation (CPI / PPI / PCE)
  "core inflation rate mom": { title: "Core CPI m/m", impact: "High" },
  "core cpi m/m": { title: "Core CPI m/m", impact: "High" },
  "core inflation rate yoy": { title: "Core CPI y/y", impact: "High" },
  "core cpi y/y": { title: "Core CPI y/y", impact: "High" },
  "inflation rate mom": { title: "CPI m/m", impact: "High" },
  "cpi m/m": { title: "CPI m/m", impact: "High" },
  "inflation rate yoy": { title: "CPI y/y", impact: "High" },
  "cpi y/y": { title: "CPI y/y", impact: "High" },
  "core ppi mom": { title: "Core PPI m/m", impact: "High" },
  "core ppi m/m": { title: "Core PPI m/m", impact: "High" },
  "ppi mom": { title: "PPI m/m", impact: "High" },
  "ppi m/m": { title: "PPI m/m", impact: "High" },
  "core pce price index mom": { title: "Core PCE Price Index m/m", impact: "High" },
  "employment cost index qoq": { title: "Employment Cost Index q/q", impact: "High" },

  // Retail Sales
  "core retail sales mom": { title: "Core Retail Sales m/m", impact: "High" },
  "retail sales control group mom": { title: "Core Retail Sales m/m", impact: "High" },
  "retail sales mom": { title: "Retail Sales m/m", impact: "High" },

  // Labor Market
  "non farm payrolls": { title: "Non-Farm Employment Change", impact: "High" },
  "unemployment rate": { title: "Unemployment Rate", impact: "High" },
  "average hourly earnings mom": { title: "Average Hourly Earnings m/m", impact: "High" },
  "adp employment change": { title: "ADP Non-Farm Employment Change", impact: "High", requiresForecast: true },
  "jolts job openings": { title: "JOLTS Job Openings", impact: "High" },
  "initial jobless claims": { title: "Unemployment Claims", impact: "Medium" },

  // PMIs & Regional Fed Indexes
  "ism manufacturing pmi": { title: "ISM Manufacturing PMI", impact: "High" },
  "ism services pmi": { title: "ISM Services PMI", impact: "Medium" },
  "ism non-manufacturing pmi": { title: "ISM Services PMI", impact: "Medium" },
  "s&p global manufacturing pmi flash": { title: "Flash Manufacturing PMI", impact: "Medium" },
  "s&p global services pmi flash": { title: "Flash Services PMI", impact: "Medium" },
  "philadelphia fed manufacturing index": { title: "Philly Fed Manufacturing Index", impact: "Medium" },
  "ny empire state manufacturing index": { title: "Empire State Manufacturing Index", impact: "Medium" },
  "empire state manufacturing index": { title: "Empire State Manufacturing Index", impact: "Medium" },
  "chicago pmi": { title: "Chicago PMI", impact: "Medium" },
  "richmond fed manufacturing index": { title: "Richmond Manufacturing Index", impact: "Medium" },

  // GDP & Consumer Confidence
  "gdp growth rate qoq adv": { title: "Advance GDP q/q", impact: "High" },
  "gdp growth rate qoq 2nd est": { title: "Prelim GDP q/q", impact: "High" },
  "gdp growth rate qoq final": { title: "Final GDP q/q", impact: "High" },
  "cb consumer confidence": { title: "CB Consumer Confidence", impact: "High" },

  // FOMC & Central Bank
  "fed interest rate decision": { title: "Federal Funds Rate", impact: "High" },
  "fomc minutes": { title: "FOMC Meeting Minutes", impact: "High" },
  "fomc meeting minutes": { title: "FOMC Meeting Minutes", impact: "High" },
  "fomc statement": { title: "FOMC Statement", impact: "High" },
  "fomc press conference": { title: "FOMC Press Conference", impact: "High" },
  "fed chair powell speaks": { title: "Fed Chair Powell Speaks", impact: "High" },
  "fed chair powell testimony": { title: "Fed Chair Powell Testifies", impact: "High" },

  // Durable Goods & Housing
  "durable goods orders mom": { title: "Durable Goods Orders m/m", impact: "Medium" },
  "core durable goods orders mom": { title: "Core Durable Goods Orders m/m", impact: "Medium" },
  "pending home sales mom": { title: "Pending Home Sales m/m", impact: "Medium" },
};

// Permanent FOMC Board Governors & NY Fed Vice Chair tracked by ForexFactory as "FOMC Member <Name> Speaks"
const FOMC_VOTING_GOVERNORS = [
  "waller",
  "bowman",
  "jefferson",
  "williams",
  "cook",
  "kugler",
  "barr",
  "miram",
];

function matchForexFactoryStrict(
  rawTitle: string,
  country: string,
  hasForecast: boolean,
  nyDate: string
): CanonicalMapping | null {
  const cleaned = rawTitle
    .trim()
    .replace(/\s*\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Q[1-4])[^)]*\)\s*$/i, "")
    .trim();
  const lower = cleaned.toLowerCase();

  if (lower.includes("opec") && lower.includes("jmmc")) {
    return { title: "OPEC-JMMC Meetings", impact: "Medium" };
  }

  if (country !== "USD") return null;

  // Never allow any "weekly" sub-series (like ADP Employment Change Weekly)
  if (lower.includes("weekly")) {
    return null;
  }

  // 1. University of Michigan (UoM) Consumer Sentiment & Inflation Expectations
  // Mid-month release (day <= 20) is "Prelim", end-of-month (day > 20) is "Revised"
  const dayOfMonth = parseInt(nyDate.slice(8, 10), 10) || 15;
  const uomPrefix = lower.includes("prelim")
    ? "Prelim"
    : lower.includes("final") || lower.includes("revised")
    ? "Revised"
    : dayOfMonth <= 20
    ? "Prelim"
    : "Revised";

  if (lower.includes("michigan consumer sentiment") || lower.includes("uom consumer sentiment")) {
    return { title: `${uomPrefix} UoM Consumer Sentiment`, impact: "Medium" };
  }
  if (
    lower.includes("michigan inflation expectations") ||
    lower.includes("michigan 1-year inflation") ||
    lower.includes("uom inflation expectations")
  ) {
    return { title: `${uomPrefix} UoM Inflation Expectations`, impact: "Medium" };
  }

  // 2. US President Speeches ("President Trump Speaks")
  if (lower.includes("trump") && (lower.includes("speak") || lower.includes("speech") || lower.includes("address"))) {
    return { title: "President Trump Speaks", impact: "Medium" };
  }

  // 3. Fed Chair Speeches
  if (
    (lower.includes("fed chair") || lower.includes("fed chairman") || lower.includes("powell") || lower.includes("warsh")) &&
    (lower.includes("speaks") || lower.includes("speech") || lower.includes("testifies") || lower.includes("testimony"))
  ) {
    if (lower.includes("warsh")) return { title: "Fed Chair Warsh Speaks", impact: "High" };
    if (lower.includes("powell")) return { title: "Fed Chair Powell Speaks", impact: "High" };
    return { title: cleaned, impact: "High" };
  }

  // 4. FOMC Voting Governors ("Fed Waller Speech" -> "FOMC Member Waller Speaks")
  if (lower.startsWith("fed ") || lower.includes("fomc member") || lower.includes("speech") || lower.includes("speaks")) {
    for (const gov of FOMC_VOTING_GOVERNORS) {
      if (lower.includes(gov)) {
        const capName = gov.charAt(0).toUpperCase() + gov.slice(1);
        return { title: `FOMC Member ${capName} Speaks`, impact: "Medium" };
      }
    }
  }

  // 5. Exact dictionary lookup
  const exact = EXACT_TV_TO_FF_MAP[lower];
  if (exact) {
    if (exact.requiresForecast && !hasForecast) {
      return null;
    }
    return exact;
  }

  return null;
}

function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

async function fetchFromTradingView(startDate: string, endDate: string): Promise<CalendarEvent[]> {
  try {
    const fromIso = `${shiftDateStr(startDate, -1)}T00:00:00.000Z`;
    const toIso = `${shiftDateStr(endDate, 1)}T23:59:59.000Z`;

    const params = new URLSearchParams();
    params.set("from", fromIso);
    params.set("to", toIso);
    params.set("countries", "US");

    const url = `https://economic-calendar.tradingview.com/events?${params.toString()}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) return [];
    const data = await res.json();
    const rawEvents = data.result || [];

    const formatted: CalendarEvent[] = [];
    const seenKeys = new Set<string>();

    for (const item of rawEvents) {
      if (!item?.date || !item?.title) continue;
      const rawDateStr = String(item.date);
      const dObj = new Date(rawDateStr);
      if (isNaN(dObj.getTime())) continue;

      const isAllDayUtc =
        rawDateStr.endsWith("T00:00:00.000Z") ||
        rawDateStr.endsWith("T00:00:00Z") ||
        item.type === "holiday";

      const nyDate = isAllDayUtc
        ? rawDateStr.slice(0, 10)
        : new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(dObj);

      if (nyDate < startDate || nyDate > endDate) continue;

      const rawTitle = String(item.title).trim();

      if (item.type === "holiday" || item.importance === -2) {
        const holidayKey = `${nyDate}_USD_Bank_Holiday`;
        if (!seenKeys.has(holidayKey)) {
          seenKeys.add(holidayKey);
          formatted.push({
            id: holidayKey,
            date: nyDate,
            time: "All Day",
            timestampIso: `${nyDate}T12:00:00.000Z`,
            country: "USD",
            impact: "Holiday",
            title: "Bank Holiday",
            forecast: "",
            previous: "",
            actual: "",
          });
        }
        continue;
      }

      const hasForecast =
        item.forecast !== null &&
        item.forecast !== undefined &&
        String(item.forecast).trim() !== "";
      const mapping = matchForexFactoryStrict(rawTitle, "USD", hasForecast, nyDate);
      if (!mapping) continue;

      const dedupKey = `${nyDate}_USD_${mapping.title}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      const nyTime = isAllDayUtc
        ? "All Day"
        : new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
            .format(dObj)
            .toLowerCase()
            .replace(/\s+/g, "");

      const scale = item.scale || "";
      const unit = item.unit || "";
      const fmtVal = (val: any) => {
        if (val === null || val === undefined || val === "") return "";
        let s = String(val);
        if (scale && !s.includes(scale)) s += scale;
        if (unit && unit !== scale && !s.includes(unit)) s += unit;
        return s;
      };

      formatted.push({
        id: dedupKey,
        date: nyDate,
        time: nyTime,
        timestampIso: dObj.toISOString(),
        country: "USD",
        impact: mapping.impact,
        title: mapping.title,
        forecast: fmtVal(item.forecast),
        previous: fmtVal(item.previous),
        actual: fmtVal(item.actual),
      });
    }

    return formatted;
  } catch (err) {
    console.warn("[Calendar API] TV fetch error:", err);
    return [];
  }
}

async function fetchFromFairEconomy(startDate: string, endDate: string): Promise<CalendarEvent[]> {
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      headers: { "User-Agent": "Mozilla/5.0 (TradeJournal/1.0)" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];

    const results: CalendarEvent[] = [];
    for (const item of items) {
      if (!item?.date || !item?.title) continue;
      const dObj = new Date(item.date);
      if (isNaN(dObj.getTime())) continue;

      const nyDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(dObj);

      if (nyDate < startDate || nyDate > endDate) continue;

      const nyTime = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
        .format(dObj)
        .toLowerCase()
        .replace(/\s+/g, "");

      const rawImpact = String(item.impact || "Low");
      let impact: CalendarEvent["impact"] = "Low";
      if (rawImpact.toLowerCase().includes("high")) impact = "High";
      else if (rawImpact.toLowerCase().includes("med")) impact = "Medium";
      else if (rawImpact.toLowerCase().includes("holiday") || rawImpact.toLowerCase().includes("non"))
        impact = "Holiday";

      const country = String(item.country || "USD").toUpperCase();
      const title = String(item.title).trim();

      results.push({
        id: `${nyDate}_${country}_${title.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 48)}`,
        date: nyDate,
        time: nyTime,
        timestampIso: dObj.toISOString(),
        country,
        impact,
        title,
        forecast: String(item.forecast || ""),
        previous: String(item.previous || ""),
        actual: String(item.actual || ""),
      });
    }
    return results;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const startDate = url.searchParams.get("start") || new Date().toISOString().slice(0, 10);
    const endDate = url.searchParams.get("end") || startDate;
    const force = url.searchParams.get("refresh") === "1";
    const cacheKey = `${startDate}_${endDate}`;

    const cached = memoryCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.timestamp < 60_000) {
      return NextResponse.json({
        events: cached.events,
        startDate,
        endDate,
        source: "cache",
      });
    }

    const ffEvents = await fetchFromFairEconomy(startDate, endDate);
    if (ffEvents.length > 0) {
      ffEvents.sort((a, b) => a.date.localeCompare(b.date) || a.timestampIso.localeCompare(b.timestampIso));
      memoryCache.set(cacheKey, { timestamp: Date.now(), events: ffEvents });
      return NextResponse.json({
        events: ffEvents,
        startDate,
        endDate,
        source: "forexfactory-native",
      });
    }

    const tvEvents = await fetchFromTradingView(startDate, endDate);
    tvEvents.sort((a, b) => a.date.localeCompare(b.date) || a.timestampIso.localeCompare(b.timestampIso));

    memoryCache.set(cacheKey, { timestamp: Date.now(), events: tvEvents });
    return NextResponse.json({
      events: tvEvents,
      startDate,
      endDate,
      source: "forexfactory-strict",
    });
  } catch (err: any) {
    return NextResponse.json(
      { events: [], error: err?.message || "Failed to load ForexFactory calendar" },
      { status: 500 }
    );
  }
}

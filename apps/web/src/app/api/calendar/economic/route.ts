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

// Strict EXACT-TITLE map (no loose substring .includes() that catch "Weekly" or sub-series)
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

  // Labor Market (Monthly NFP, ADP, JOLTS, Weekly Jobless Claims)
  "non farm payrolls": { title: "Non-Farm Employment Change", impact: "High" },
  "unemployment rate": { title: "Unemployment Rate", impact: "High" },
  "average hourly earnings mom": { title: "Average Hourly Earnings m/m", impact: "High" },
  "adp employment change": { title: "ADP Non-Farm Employment Change", impact: "High", requiresForecast: true },
  "jolts job openings": { title: "JOLTS Job Openings", impact: "High" },
  "initial jobless claims": { title: "Unemployment Claims", impact: "Medium" },

  // PMIs & Regional Fed Indexes
  "ism manufacturing pmi": { title: "ISM Manufacturing PMI", impact: "High" },
  "ism services pmi": { title: "ISM Services PMI", impact: "High" },
  "ism non-manufacturing pmi": { title: "ISM Services PMI", impact: "High" },
  "s&p global manufacturing pmi flash": { title: "Flash Manufacturing PMI", impact: "Medium" },
  "s&p global services pmi flash": { title: "Flash Services PMI", impact: "Medium" },
  "philadelphia fed manufacturing index": { title: "Philly Fed Manufacturing Index", impact: "Medium" },
  "ny empire state manufacturing index": { title: "Empire State Manufacturing Index", impact: "Medium" },
  "empire state manufacturing index": { title: "Empire State Manufacturing Index", impact: "Medium" },
  "chicago pmi": { title: "Chicago PMI", impact: "Medium" },
  "richmond fed manufacturing index": { title: "Richmond Manufacturing Index", impact: "Medium" },

  // GDP, Consumer Confidence & Sentiment
  "gdp growth rate qoq adv": { title: "Advance GDP q/q", impact: "High" },
  "gdp growth rate qoq 2nd est": { title: "Prelim GDP q/q", impact: "High" },
  "gdp growth rate qoq final": { title: "Final GDP q/q", impact: "High" },
  "cb consumer confidence": { title: "CB Consumer Confidence", impact: "High" },
  "michigan consumer sentiment prelim": { title: "Prelim UoM Consumer Sentiment", impact: "Medium" },
  "michigan consumer sentiment final": { title: "Revised UoM Consumer Sentiment", impact: "Medium" },
  "michigan inflation expectations prelim": { title: "Prelim UoM Inflation Expectations", impact: "Medium" },
  "michigan inflation expectations final": { title: "Revised UoM Inflation Expectations", impact: "Medium" },

  // FOMC & Central Bank
  "fed interest rate decision": { title: "Federal Funds Rate", impact: "High" },
  "fomc minutes": { title: "FOMC Meeting Minutes", impact: "Medium" },
  "fomc statement": { title: "FOMC Statement", impact: "High" },
  "fomc press conference": { title: "FOMC Press Conference", impact: "High" },
  "fed chair powell speaks": { title: "Fed Chair Powell Speaks", impact: "High" },
  "fed chair powell testimony": { title: "Fed Chair Powell Testifies", impact: "High" },

  // Durable Goods & Housing
  "durable goods orders mom": { title: "Durable Goods Orders m/m", impact: "Medium" },
  "core durable goods orders mom": { title: "Core Durable Goods Orders m/m", impact: "Medium" },
  "pending home sales mom": { title: "Pending Home Sales m/m", impact: "Medium" },
};

function matchForexFactoryStrict(rawTitle: string, country: string, hasForecast: boolean): CanonicalMapping | null {
  if (country !== "USD") return null;

  // Strip trailing month/quarter parentheticals like " (Sep)" or " (Q3)" before exact lookup
  const cleaned = rawTitle
    .trim()
    .replace(/\s*\((?:Janert{}Febert{}Marert{}Aprert{}Mayert{}Junert{}Julert{}Augert{}Sepert{}Octert{}Novert{}Decert{}Q[1-4])[^)]*\)\s*$/i, "")
    .trim();
  const lower = cleaned.toLowerCase();

  // Never allow any "weekly" sub-series (except Initial Jobless Claims which is in EXACT_TV_TO_FF_MAP)
  if (lower.includes("weekly")) {
    return null;
  }

  const exact = EXACT_TV_TO_FF_MAP[lower];
  if (exact) {
    if (exact.requiresForecast && !hasForecast) {
      return null;
    }
    return exact;
  }

  // Allow Fed Chair speeches dynamically
  if (
    (lower.includes("fed chair") || lower.includes("fed chairman")) &&
    (lower.includes("speaks") || lower.includes("speech") || lower.includes("testifies"))
  ) {
    return { title: cleaned, impact: "High" };
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

      // Bank Holidays
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

      const hasForecast = item.forecast !== null && item.forecast !== undefined && String(item.forecast).trim() !== "";
      const mapping = matchForexFactoryStrict(rawTitle, "USD", hasForecast);
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

    // 1. Official FairEconomy (ForexFactory) live feed for current week
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

    // 2. Strict Exact-Title ForexFactory map for past/future weeks
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

import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getCandleDb } from "@/server/market-data/candle-db";
import {
  ensureJournalSchema,
  getJournalConfig,
  INITIAL_NOTE_TEMPLATES,
  parseSlugRange,
  saveJournalEntry,
} from "@/server/journal-service";
import {
  getNotionConfig,
  editorHtmlToNotionTree,
  clearNotionPageBlocks,
  appendBlocksTreeRecursive,
  findNotionPageInDb,
} from "@/server/notion-sync";

export const dynamic = "force-dynamic";

function resolveJournalDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function resolveCandleDbPath(): string {
  const rootData = path.resolve(process.cwd(), "apps/web/data");
  const localData = path.resolve(process.cwd(), "data");
  const targetDir = fs.existsSync(path.resolve(process.cwd(), "apps/web")) ? rootData : localData;
  return path.join(targetDir, "market_candles.db");
}

function getFileWithWalSize(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  let total = fs.statSync(filePath).size;
  if (fs.existsSync(`${filePath}-wal`)) {
    total += fs.statSync(`${filePath}-wal`).size;
  }
  return total;
}

function byteLen(str: string | null | undefined): number {
  if (!str) return 0;
  return Buffer.byteLength(String(str), "utf8");
}

function inlineImageBytes(html: string | null | undefined): number {
  if (!html) return 0;
  let total = 0;
  const matches = String(html).matchAll(/src=["'](data:image\/[^"']+)["']/gi);
  for (const m of matches) {
    if (m[1]) total += Buffer.byteLength(m[1], "utf8");
  }
  return total;
}

function inferAssetClassFromSymbol(
  rawSymbol: string | null | undefined
): "futures" | "forex" | "crypto" | "equities" {
  const s = String(rawSymbol || "").toUpperCase().trim();
  if (!s) return "futures";

  if (
    ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ADA", "AVAX", "USDT", "USDC"].some((k) =>
      s.includes(k)
    )
  ) {
    return "crypto";
  }

  if (
    [
      "SPX", "US500", "ES.C", "MES", "NAS", "NDX", "US100", "USTEC", "NQ.C", "MNQ",
      "US30", "DJ30", "DOW", "YM.C", "MYM", "US2000", "RUT", "RTY", "UK100", "FTSE",
      "DE30", "DE40", "GER", "DAX", "EU50", "JP225", "AU200", "HK33", "CN50", "VIX",
      "WTICO", "USOIL", "UKOIL", "BCO", "CL.C",
    ].some((k) => s.includes(k)) ||
    /^(ES|NQ|YM|RTY|MES|MNQ|CL|NG)(\.[A-Z]\.[0-9]+)?$/.test(s)
  ) {
    return "futures";
  }

  if (
    [
      "XAU", "XAG", "GOLD", "SILVER", "GC.C", "SI.C", "EUR", "GBP", "JPY",
      "AUD", "CAD", "CHF", "NZD", "DXY",
    ].some((k) => s.includes(k)) ||
    /^[A-Z]{3}\/[A-Z]{3}$/.test(s) ||
    /^[A-Z]{6}$/.test(s)
  ) {
    return "forex";
  }

  return "equities";
}

function classifyCandleProvider(
  rawProvider: string
): "databento" | "londonstrategicedge" | "csv" | "other" {
  const lower = String(rawProvider || "").toLowerCase();
  if (
    lower.includes("databento") ||
    lower.includes("glbx") ||
    lower.includes("xnas") ||
    lower.includes("dbn")
  ) {
    return "databento";
  }
  if (
    lower.includes("london-strategic-edge") ||
    lower.includes("londonstrategicedge") ||
    lower.includes("london strategic edge") ||
    lower.includes("lse")
  ) {
    return "londonstrategicedge";
  }
  if (lower.includes("csv") || lower.includes("upload")) {
    return "csv";
  }
  return "other";
}

function normalizeHtmlForComparison(html: string | null | undefined): string {
  if (!html) return "";
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/data-open=["'](?:true|false)["']/gi, "")
    .replace(/style=["'][^"']*["']/gi, "")
    .replace(/[▸▾]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSubstantiveJournalContent(
  html: string | null | undefined,
  templateNormSet: Set<string>
): boolean {
  if (!html || !String(html).trim()) return false;
  const raw = String(html);
  if (/<img\b/i.test(raw)) return true;
  const norm = normalizeHtmlForComparison(raw);
  if (!norm) return false;
  if (
    norm === "type / for commands..." ||
    norm === "type '/' for commands..." ||
    norm === "write your review here..."
  ) {
    return false;
  }
  if (templateNormSet.has(norm)) {
    return false;
  }
  return true;
}

interface CandleSeriesItem {
  seriesKey: string;
  sourceType: "candles_db" | "csv_table" | "excursions_table";
  providerRaw: string;
  providerCategory: "databento" | "londonstrategicedge" | "csv" | "other";
  symbol: string;
  assetClass: "futures" | "forex" | "crypto" | "equities";
  timeframe: string;
  barCount: number;
  bytes: number;
  rangeBarCount: number;
  rangeBytes: number;
  firstDate: string;
  lastDate: string;
}

function queryAllCandleSeries(
  journalDb: Database.Database,
  startDate = "2000-01-01",
  endDate = "2099-12-31"
): {
  series: CandleSeriesItem[];
  candleDbDiskBytes: number;
} {
  const series: CandleSeriesItem[] = [];
  const candleDbPath = resolveCandleDbPath();
  const candleDbDiskBytes = getFileWithWalSize(candleDbPath);

  // 1. Query market_candles.db -> candles (provider, symbol, timeframe, time, ...)
  try {
    const cdb = getCandleDb();
    const startMs = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${endDate}T23:59:59.999Z`).getTime();
    const rows = cdb
      .prepare(
        `SELECT provider, symbol, timeframe,
                COUNT(*) as cnt,
                SUM(CASE WHEN time >= ? AND time <= ? THEN 1 ELSE 0 END) as range_cnt,
                MIN(time) as min_t,
                MAX(time) as max_t
         FROM candles
         GROUP BY provider, symbol, timeframe
         ORDER BY cnt DESC`
      )
      .all(startMs, endMs) as any[];

    const totalBarsInCandleDb = rows.reduce((acc, r) => acc + Number(r.cnt || 0), 0);

    for (const r of rows) {
      const cnt = Number(r.cnt || 0);
      if (cnt <= 0) continue;
      const provRaw = String(r.provider || "unknown");
      const sym = String(r.symbol || "UNKNOWN");
      const tf = String(r.timeframe || "1m");
      const minT = Number(r.min_t || 0);
      const maxT = Number(r.max_t || 0);
      const minMs = minT < 1e11 ? minT * 1000 : minT;
      const maxMs = maxT < 1e11 ? maxT * 1000 : maxT;

      // Distribute actual market_candles.db disk file size proportionally across series
      const propBytes =
        candleDbDiskBytes > 0 && totalBarsInCandleDb > 0
          ? Math.round((cnt / totalBarsInCandleDb) * candleDbDiskBytes)
          : cnt * 96;

      const rCnt = Number(r.range_cnt ?? cnt);
      const rBytes = cnt > 0 ? Math.round((rCnt / cnt) * propBytes) : 0;
      series.push({
        seriesKey: `candles_db||${provRaw}||${sym}||${tf}`,
        sourceType: "candles_db",
        providerRaw: provRaw,
        providerCategory: classifyCandleProvider(provRaw),
        symbol: sym,
        assetClass: inferAssetClassFromSymbol(sym),
        timeframe: tf,
        barCount: cnt,
        bytes: propBytes,
        rangeBarCount: rCnt,
        rangeBytes: rBytes,
        firstDate: minMs > 0 ? new Date(minMs).toISOString().slice(0, 10) : "—",
        lastDate: maxMs > 0 ? new Date(maxMs).toISOString().slice(0, 10) : "—",
      });
    }
  } catch (err) {
    console.warn("[DataManagement] Failed to read market_candles.db:", err);
  }

  // 2. Query journal.db -> market_csv_datasets (if any uploaded CSV candle datasets exist)
  try {
    const csvRows = journalDb
      .prepare(
        `SELECT id, name, symbol, resolution, bar_count, first_time, last_time, length(bars_json) as b_len
         FROM market_csv_datasets`
      )
      .all() as any[];

    for (const r of csvRows) {
      const sym = String(r.symbol || r.name || r.id);
      const tf = String(r.resolution || "1m");
      const minT = Number(r.first_time || 0);
      const maxT = Number(r.last_time || 0);
      const minMs = minT < 1e11 ? minT * 1000 : minT;
      const maxMs = maxT < 1e11 ? maxT * 1000 : maxT;

      series.push({
        seriesKey: `csv_table||market-csv||${r.id}||${tf}`,
        sourceType: "csv_table",
        providerRaw: "market-csv",
        providerCategory: "csv",
        symbol: sym,
        assetClass: inferAssetClassFromSymbol(sym),
        timeframe: tf,
        barCount: Number(r.bar_count || 0),
        bytes: Number(r.b_len || 0) + 128,
        rangeBarCount: Number(r.bar_count || 0),
        rangeBytes: Number(r.b_len || 0) + 128,
        firstDate: minMs > 0 ? new Date(minMs).toISOString().slice(0, 10) : "—",
        lastDate: maxMs > 0 ? new Date(maxMs).toISOString().slice(0, 10) : "—",
      });
    }
  } catch {}

  // 3. Query journal.db -> trade_excursions (cached MFE/MAE excursion JSONs)
  try {
    const exRows = journalDb
      .prepare(
        `SELECT provider, COUNT(*) as cnt, COALESCE(SUM(length(estimate_json) + 96), 0) as b_len,
                MIN(fetched_at) as min_f, MAX(fetched_at) as max_f
         FROM trade_excursions
         GROUP BY provider`
      )
      .all() as any[];

    for (const r of exRows) {
      const cnt = Number(r.cnt || 0);
      if (cnt <= 0) continue;
      const provRaw = String(r.provider || "london-strategic-edge");
      series.push({
        seriesKey: `excursions_table||${provRaw}||Excursions||1m`,
        sourceType: "excursions_table",
        providerRaw: provRaw,
        providerCategory: classifyCandleProvider(provRaw),
        symbol: "Trade Excursion Caches",
        assetClass: "futures",
        timeframe: "excursions",
        barCount: cnt,
        bytes: Number(r.b_len || 0),
        rangeBarCount: cnt,
        rangeBytes: Number(r.b_len || 0),
        firstDate: String(r.min_f || "").slice(0, 10) || "—",
        lastDate: String(r.max_f || "").slice(0, 10) || "—",
      });
    }
  } catch {}

  return { series, candleDbDiskBytes };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate") || "2000-01-01";
    const endDate = url.searchParams.get("endDate") || "2099-12-31";

    const dbPath = resolveJournalDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 404 });
    }

    const journalDiskBytes = getFileWithWalSize(dbPath);
    const db = new Database(dbPath, { readonly: true });

    try {
      const { series: candleSeries, candleDbDiskBytes } = queryAllCandleSeries(
        db,
        startDate,
        endDate
      );
      const totalDiskBytes = journalDiskBytes + candleDbDiskBytes;

      // 1. Attachments breakdown
      let attachmentRows: Array<{ owner_type: string; cnt: number; bytes: number }> = [];
      try {
        attachmentRows = db
          .prepare(
            `SELECT owner_type, COUNT(*) as cnt, COALESCE(SUM( length(data) ), 0) as bytes
             FROM attachments
             GROUP BY owner_type`
          )
          .all() as any[];
      } catch {}

      const attMap: Record<string, { count: number; bytes: number }> = {};
      for (const r of attachmentRows) {
        attMap[r.owner_type] = { count: Number(r.cnt || 0), bytes: Number(r.bytes || 0) };
      }

      // 2. Trade Database
      const trades = db.prepare(`SELECT * FROM trades`).all() as any[];
      const executions = db.prepare(`SELECT * FROM executions`).all() as any[];
      let tradeRowBytes = 0;
      let tradeInlineImgBytes = 0;
      for (const t of trades) {
        tradeRowBytes +=
          byteLen(t.key) +
          byteLen(t.symbol) +
          byteLen(t.notes) +
          byteLen(t.review_notes) +
          byteLen(t.exits_json) +
          byteLen(t.execution_ids_json) +
          byteLen(t.partials_breakdown) +
          byteLen(t.tags_json) +
          120;
        tradeInlineImgBytes += inlineImageBytes(t.notes) + inlineImageBytes(t.review_notes);
      }
      for (const ex of executions) {
        tradeRowBytes += byteLen(ex.id) + byteLen(ex.symbol) + byteLen(ex.import_metadata_json) + 80;
      }
      const tradeAttBytes = (attMap["trade"]?.bytes || 0) + (attMap["trades"]?.bytes || 0);
      const tradeAttCount = (attMap["trade"]?.count || 0) + (attMap["trades"]?.count || 0);

      // 3. Daily & Periodic Journal Databases
      let journalRows: any[] = [];
      try {
        journalRows = db.prepare(`SELECT * FROM journal_entries`).all() as any[];
      } catch {}
      let legacyDays: any[] = [];
      try {
        legacyDays = db.prepare(`SELECT * FROM journal_days`).all() as any[];
      } catch {}

      let dailyCount = 0;
      let dailyTextBytes = 0;
      let dailyInlineImgBytes = 0;
      let periodicCount = 0;
      let periodicTextBytes = 0;
      let periodicInlineImgBytes = 0;
      const periodicBreakdown: Record<string, number> = { week: 0, month: 0, quarter: 0, year: 0 };

      for (const j of journalRows) {
        const cBytes =
          byteLen(j.slug) +
          byteLen(j.title) +
          byteLen(j.content) +
          byteLen(j.review_content) +
          byteLen(j.lessons_learned) +
          byteLen(j.checklist_json) +
          byteLen(j.scores_json) +
          100;
        const imgBytes = inlineImageBytes(j.content) + inlineImageBytes(j.review_content);

        if (j.period_type === "day") {
          dailyCount++;
          dailyTextBytes += cBytes;
          dailyInlineImgBytes += imgBytes;
        } else {
          periodicCount++;
          periodicTextBytes += cBytes;
          periodicInlineImgBytes += imgBytes;
          if (j.period_type in periodicBreakdown) periodicBreakdown[j.period_type]!++;
        }
      }

      for (const ld of legacyDays) {
        dailyTextBytes += byteLen(ld.date) + byteLen(ld.note) + 40;
        dailyInlineImgBytes += inlineImageBytes(ld.note);
      }

      const dailyAttBytes = (attMap["day"]?.bytes || 0) + (attMap["editor"]?.bytes || 0);
      const dailyAttCount = (attMap["day"]?.count || 0) + (attMap["editor"]?.count || 0);
      const periodicAttBytes =
        (attMap["week"]?.bytes || 0) +
        (attMap["month"]?.bytes || 0) +
        (attMap["quarter"]?.bytes || 0) +
        (attMap["year"]?.bytes || 0);
      const periodicAttCount =
        (attMap["week"]?.count || 0) +
        (attMap["month"]?.count || 0) +
        (attMap["quarter"]?.count || 0) +
        (attMap["year"]?.count || 0);

      // 4. Aggregate Candlestick Telemetry by Provider, Asset Class & Individual Ticker Series
      let candleTotalBytes = 0;
      let candleTotalBars = 0;

      const byProvider: Record<string, { count: number; bytes: number; bars: number }> = {
        databento: { count: 0, bytes: 0, bars: 0 },
        londonstrategicedge: { count: 0, bytes: 0, bars: 0 },
        csv: { count: 0, bytes: 0, bars: 0 },
        other: { count: 0, bytes: 0, bars: 0 },
      };

      const byAssetClass: Record<string, { count: number; bytes: number; bars: number }> = {
        futures: { count: 0, bytes: 0, bars: 0 },
        forex: { count: 0, bytes: 0, bars: 0 },
        crypto: { count: 0, bytes: 0, bars: 0 },
        equities: { count: 0, bytes: 0, bars: 0 },
      };

      for (const s of candleSeries) {
        candleTotalBytes += s.bytes;
        candleTotalBars += s.barCount;

        const pBucket = byProvider[s.providerCategory] || byProvider.other!;
        pBucket.count++;
        pBucket.bytes += s.bytes;
        pBucket.bars += s.barCount;

        const aBucket = byAssetClass[s.assetClass] || byAssetClass.futures!;
        aBucket.count++;
        aBucket.bytes += s.bytes;
        aBucket.bars += s.barCount;
      }

      return NextResponse.json({
        ok: true,
        totalDiskBytes,
        journalDiskBytes,
        candleDbDiskBytes,
        candleBreakdown: {
          byProvider,
          byAssetClass,
          series: candleSeries,
        },
        databases: {
          trades: {
            label: "Trade Database",
            description: "Executed trades, partial fills, rule checks & trade chart screenshots",
            rowCount: trades.length,
            subCountLabel: `${trades.length} trades • ${executions.length} executions`,
            dataBytes: tradeRowBytes,
            attachmentBytes: tradeAttBytes + tradeInlineImgBytes,
            attachmentCount: tradeAttCount,
            totalBytes: tradeRowBytes + tradeAttBytes,
          },
          daily: {
            label: "Daily Journal Database",
            description: "Daily session prep notes, end-of-day reviews & pasted daily charts",
            rowCount: dailyCount,
            subCountLabel: `${dailyCount} daily journals`,
            dataBytes: dailyTextBytes,
            attachmentBytes: dailyAttBytes + dailyInlineImgBytes,
            attachmentCount: dailyAttCount,
            totalBytes: dailyTextBytes + dailyAttBytes,
          },
          periodic: {
            label: "Periodic Journal Database",
            description: "Weekly, Monthly, Quarterly & Annual synthesis and review pages",
            rowCount: periodicCount,
            subCountLabel: `${periodicBreakdown.week}W • ${periodicBreakdown.month}M • ${periodicBreakdown.quarter}Q • ${periodicBreakdown.year}Y`,
            dataBytes: periodicTextBytes,
            attachmentBytes: periodicAttBytes + periodicInlineImgBytes,
            attachmentCount: periodicAttCount,
            totalBytes: periodicTextBytes + periodicAttBytes,
          },
          candles: {
            label: "Chart Replay & Candlesticks Database (market_candles.db)",
            description: "Cached candles from Databento (Paid), London Strategic Edge (Free) & CSVs",
            rowCount: candleSeries.length,
            subCountLabel: `${candleSeries.length} ticker series • ${candleTotalBars.toLocaleString()} cached bars`,
            dataBytes: candleTotalBytes,
            attachmentBytes: 0,
            attachmentCount: 0,
            totalBytes: candleTotalBytes,
          },
        },
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to compute database telemetry" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;
    const startDate = String(body.startDate || "2020-01-01").slice(0, 10);
    const endDate = String(body.endDate || "2099-12-31").slice(0, 10);
    const ignoreDateRangeForCandles = Boolean(body.ignoreDateRangeForCandles);
    const targets: string[] = Array.isArray(body.targets)
      ? body.targets
      : ["daily", "periodic", "trades"];
    const selectedSeriesKeys: string[] = Array.isArray(body.selectedSeriesKeys)
      ? body.selectedSeriesKeys
      : [];

    const dbPath = resolveJournalDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ ok: false, error: "Database not found" }, { status: 404 });
    }

    if (action === "push_notion") {
      const cfg = getJournalConfig();
      const templateNormSet = new Set<string>();
      for (const t of [...INITIAL_NOTE_TEMPLATES, ...(cfg.templates || [])]) {
        const n = normalizeHtmlForComparison(t.html);
        if (n) templateNormSet.add(n);
      }

      const db = new Database(dbPath);
      ensureJournalSchema(db);

      let pushedPages = 0;
      let skippedEmptyOrTemplate = 0;
      const errors: string[] = [];

      try {
        const allEntries = db.prepare(`SELECT * FROM journal_entries ORDER BY slug ASC`).all() as any[];

        for (const row of allEntries) {
          const range = parseSlugRange(row.slug);
          const isDaily = range.periodType === "day";

          if (isDaily && !targets.includes("daily")) continue;
          if (!isDaily && !targets.includes("periodic")) continue;
          if (range.endDate < startDate || range.startDate > endDate) continue;

          const { token, databaseId } = getNotionConfig(range.periodType);
          if (!token || !databaseId) {
            errors.push(`Missing Notion config for ${range.periodType}`);
            continue;
          }

          for (const tab of ["prep", "review"] as const) {
            const isReview = tab === "review";
            const htmlContent = isReview ? row.review_content : row.content;

            if (!isSubstantiveJournalContent(htmlContent, templateNormSet)) {
              skippedEmptyOrTemplate++;
              continue;
            }

            const targetSlug = isReview ? `${row.slug}-review` : row.slug;
            const baseTitle = row.title || range.defaultTitle;
            const targetTitle = isReview ? baseTitle.replace("Journal", "Review") : baseTitle;
            const categoryLabel = isReview
              ? `${range.periodType.toUpperCase()} REVIEW`
              : range.periodType.toUpperCase();

            try {
              const found = await findNotionPageInDb(databaseId, token, targetSlug, targetTitle);
              const availableProps = found.availableProps || {};
              const titlePropName = found.titleProp || "Name";

              const properties: Record<string, any> = {
                [titlePropName]: {
                  title: [{ text: { content: targetTitle } }],
                },
              };

              if ("Slug" in availableProps && availableProps["Slug"].type === "rich_text") {
                properties["Slug"] = { rich_text: [{ text: { content: targetSlug } }] };
              }
              if ("Period" in availableProps && availableProps["Period"].type === "select") {
                properties["Period"] = { select: { name: categoryLabel } };
              }
              for (const catKey of ["Category", "Type", "Kind", "Tab"]) {
                if (catKey in availableProps) {
                  if (availableProps[catKey].type === "select") {
                    properties[catKey] = {
                      select: { name: isReview ? "Review" : "Preparation" },
                    };
                  } else if (availableProps[catKey].type === "rich_text") {
                    properties[catKey] = {
                      rich_text: [{ text: { content: isReview ? "Review" : "Preparation" } }],
                    };
                  }
                }
              }
              if ("Date" in availableProps && availableProps["Date"].type === "date") {
                properties["Date"] = { date: { start: range.startDate } };
              }
              if ("Open Date" in availableProps && availableProps["Open Date"].type === "date") {
                properties["Open Date"] = { date: { start: range.startDate } };
              }

              const blockTree = await editorHtmlToNotionTree(htmlContent, token);
              let targetPageId = isReview
                ? row.review_notion_page_id || found.page?.id
                : row.notion_page_id || found.page?.id;
              let targetPageUrl = isReview
                ? found.page?.url || row.review_notion_url
                : found.page?.url || row.notion_url;

              if (targetPageId) {
                const patchRes = await fetch(`https://api.notion.com/v1/pages/${targetPageId}`, {
                  method: "PATCH",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ properties }),
                });

                if (!patchRes.ok) {
                  targetPageId = null;
                } else {
                  const patchData = await patchRes.json();
                  targetPageUrl = patchData.url || targetPageUrl;
                  await clearNotionPageBlocks(targetPageId, token);
                  await appendBlocksTreeRecursive(targetPageId, blockTree, token);
                }
              }

              if (!targetPageId) {
                const createRes = await fetch("https://api.notion.com/v1/pages", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    parent: { database_id: databaseId },
                    properties,
                  }),
                });

                if (createRes.ok) {
                  const createdData = await createRes.json();
                  targetPageId = createdData.id;
                  targetPageUrl = createdData.url;
                  if (targetPageId && blockTree.length > 0) {
                    await appendBlocksTreeRecursive(targetPageId, blockTree, token);
                  }
                }
              }

              if (targetPageId) {
                await saveJournalEntry(
                  row.slug,
                  isReview
                    ? { reviewNotionPageId: targetPageId, reviewNotionUrl: targetPageUrl }
                    : { notionPageId: targetPageId, notionUrl: targetPageUrl }
                );
                pushedPages++;
              }
            } catch (err: any) {
              errors.push(`${targetSlug}: ${err?.message || "Sync failed"}`);
            }
          }
        }
      } finally {
        db.close();
      }

      return NextResponse.json({
        ok: true,
        pushedPages,
        skippedEmptyOrTemplate,
        errors: errors.slice(0, 10),
        message: `Synced ${pushedPages} substantive page(s) to Notion. Skipped ${skippedEmptyOrTemplate} empty or unmodified default-template page(s).`,
      });
    }

    if (action === "delete_range") {
      const onlySyncedToNotion = Boolean(body.onlySyncedToNotion);
      const db = new Database(dbPath);
      ensureJournalSchema(db);

      const deletedCounts = {
        trades: 0,
        daily: 0,
        periodic: 0,
        candles: 0,
      };

      try {
        if (targets.includes("trades")) {
          const syncClause = onlySyncedToNotion ? "AND notion_page_id IS NOT NULL" : "";
          const toDel = db
            .prepare(
              `SELECT key FROM trades
               WHERE substr(opened_at, 1, 10) >= ? AND substr(opened_at, 1, 10) <= ? ${syncClause}`
            )
            .all(startDate, endDate) as Array<{ key: string }>;

          for (const t of toDel) {
            db.prepare(`DELETE FROM executions WHERE id LIKE ?`).run(`exec_${t.key}_%`);
            try {
              db.prepare(`DELETE FROM trade_rule_checks WHERE trade_key = ?`).run(t.key);
              db.prepare(`DELETE FROM attachments WHERE owner_id = ?`).run(t.key);
            } catch {}
            db.prepare(`DELETE FROM trades WHERE key = ?`).run(t.key);
            deletedCounts.trades++;
          }
        }

        if (targets.includes("daily") || targets.includes("periodic")) {
          const allEntries = db
            .prepare(`SELECT slug, period_type, notion_page_id FROM journal_entries`)
            .all() as any[];
          for (const row of allEntries) {
            const range = parseSlugRange(row.slug);
            const isDaily = range.periodType === "day";
            if (isDaily && !targets.includes("daily")) continue;
            if (!isDaily && !targets.includes("periodic")) continue;
            if (onlySyncedToNotion && !row.notion_page_id) continue;

            if (range.startDate >= startDate && range.endDate <= endDate) {
              db.prepare(`DELETE FROM journal_entries WHERE slug = ?`).run(row.slug);
              try {
                db.prepare(
                  `DELETE FROM attachments WHERE owner_id = ? OR owner_id = ?`
                ).run(row.slug, `${row.slug}-review`);
              } catch {}
              if (isDaily) {
                try {
                  db.prepare(`DELETE FROM journal_days WHERE date = ?`).run(row.slug);
                } catch {}
                deletedCounts.daily++;
              } else {
                deletedCounts.periodic++;
              }
            }
          }
        }

        // Delete selected candlestick ticker series
        if (targets.includes("candles") && selectedSeriesKeys.length > 0) {
          const startMs = ignoreDateRangeForCandles
            ? 0
            : new Date(`${startDate}T00:00:00.000Z`).getTime();
          const endMs = ignoreDateRangeForCandles
            ? Number.MAX_SAFE_INTEGER
            : new Date(`${endDate}T23:59:59.999Z`).getTime();

          const cdb = getCandleDb();
          let touchedCandleDb = false;

          for (const key of selectedSeriesKeys) {
            const [sourceType, provRaw, symOrId, tf] = key.split("||");
            if (sourceType === "candles_db" && provRaw && symOrId && tf) {
              const res = ignoreDateRangeForCandles
                ? cdb
                    .prepare(
                      `DELETE FROM candles WHERE provider = ? AND symbol = ? AND timeframe = ?`
                    )
                    .run(provRaw, symOrId, tf)
                : cdb
                    .prepare(
                      `DELETE FROM candles
                       WHERE provider = ? AND symbol = ? AND timeframe = ? AND time BETWEEN ? AND ?`
                    )
                    .run(provRaw, symOrId, tf, startMs, endMs);
              deletedCounts.candles += res.changes;
              touchedCandleDb = true;
            } else if (sourceType === "csv_table" && symOrId) {
              const res = db
                .prepare(`DELETE FROM market_csv_datasets WHERE id = ?`)
                .run(symOrId);
              deletedCounts.candles += res.changes;
            } else if (sourceType === "excursions_table" && provRaw) {
              const res = ignoreDateRangeForCandles
                ? db.prepare(`DELETE FROM trade_excursions WHERE provider = ?`).run(provRaw)
                : db
                    .prepare(
                      `DELETE FROM trade_excursions
                       WHERE provider = ? AND substr(fetched_at, 1, 10) >= ? AND substr(fetched_at, 1, 10) <= ?`
                    )
                    .run(provRaw, startDate, endDate);
              deletedCounts.candles += res.changes;
            }
          }

          if (touchedCandleDb) {
            try {
              cdb.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
              cdb.exec(`VACUUM;`);
            } catch {}
          }
        }

        db.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
        db.exec(`VACUUM;`);
      } finally {
        db.close();
      }

      return NextResponse.json({
        ok: true,
        deletedCounts,
        message: `Deleted ${deletedCounts.trades} trades, ${deletedCounts.daily} daily journals, ${deletedCounts.periodic} periodic journals, and ${deletedCounts.candles.toLocaleString()} cached candle bars. Databases vacuumed.`,
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Data management operation failed" },
      { status: 500 }
    );
  }
}

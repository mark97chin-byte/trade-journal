import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
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

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
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

// Strips HTML tags, entities, and whitespace so we can compare against empty or unmodified default templates
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

  // If the user pasted or uploaded any image/screenshot, it is always substantive
  if (/<img\b/i.test(raw)) return true;

  const norm = normalizeHtmlForComparison(raw);
  if (!norm) return false;

  // Common empty placeholder strings
  if (
    norm === "type / for commands..." ||
    norm === "type '/' for commands..." ||
    norm === "write your review here..."
  ) {
    return false;
  }

  // If the normalized text matches ANY default or custom template, treat it as unmodified template (do not overwrite Notion!)
  if (templateNormSet.has(norm)) {
    return false;
  }

  return true;
}

export async function GET() {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 404 });
    }

    const fileStats = fs.statSync(dbPath);
    const walPath = `${dbPath}-wal`;
    const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    const totalDiskBytes = fileStats.size + walBytes;

    const db = new Database(dbPath, { readonly: true });
    try {
      // 1. Attachments breakdown by owner_type
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

      // 2. Trade Database (trades + executions + trade_rule_checks + missed_trades)
      const trades = db.prepare(`SELECT * FROM trades`).all() as any[];
      const executions = db.prepare(`SELECT * FROM executions`).all() as any[];
      let ruleChecksBytes = 0;
      try {
        const rc = db
          .prepare(`SELECT COALESCE(SUM(length(rule) + length(trade_key)), 0) as b FROM trade_rule_checks`)
          .get() as any;
        ruleChecksBytes = Number(rc?.b || 0);
      } catch {}

      let tradeRowBytes = ruleChecksBytes;
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
      const periodicBreakdown: Record<string, number> = {
        week: 0,
        month: 0,
        quarter: 0,
        year: 0,
      };

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
          if (j.period_type in periodicBreakdown) {
            periodicBreakdown[j.period_type]!++;
          }
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

      // 4. Chart Replay / Candlesticks Database (trade_excursions + market_csv_datasets)
      let excursionCount = 0;
      let excursionBytes = 0;
      try {
        const exStat = db
          .prepare(
            `SELECT COUNT(*) as cnt, COALESCE(SUM(length(estimate_json) + length(trade_key) + 64), 0) as bytes
             FROM trade_excursions`
          )
          .get() as any;
        excursionCount = Number(exStat?.cnt || 0);
        excursionBytes = Number(exStat?.bytes || 0);
      } catch {}

      let csvDatasetCount = 0;
      let csvDatasetBytes = 0;
      let totalBarsStored = 0;
      try {
        const csvStat = db
          .prepare(
            `SELECT COUNT(*) as cnt,
                    COALESCE(SUM(length(bars_json) + length(name) + 80), 0) as bytes,
                    COALESCE(SUM(bar_count), 0) as bars
             FROM market_csv_datasets`
          )
          .get() as any;
        csvDatasetCount = Number(csvStat?.cnt || 0);
        csvDatasetBytes = Number(csvStat?.bytes || 0);
        totalBarsStored = Number(csvStat?.bars || 0);
      } catch {}

      return NextResponse.json({
        ok: true,
        totalDiskBytes,
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
            label: "Chart Replay & Candlesticks Database",
            description: "Historical OHLCV candlestick datasets & 1m trade excursion caches",
            rowCount: csvDatasetCount + excursionCount,
            subCountLabel: `${csvDatasetCount} datasets (${totalBarsStored.toLocaleString()} bars) • ${excursionCount} trade excursions`,
            dataBytes: csvDatasetBytes + excursionBytes,
            attachmentBytes: 0,
            attachmentCount: 0,
            totalBytes: csvDatasetBytes + excursionBytes,
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
    const targets: string[] = Array.isArray(body.targets)
      ? body.targets
      : ["daily", "periodic", "trades"];

    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ ok: false, error: "Database not found" }, { status: 404 });
    }

    // ==========================================================================
    // ACTION 1: PUSH DATE RANGE TO NOTION (SKIPPING EMPTY & DEFAULT-TEMPLATE PAGES)
    // ==========================================================================
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

          // Check if entry overlaps [startDate, endDate]
          if (range.endDate < startDate || range.startDate > endDate) continue;

          const { token, databaseId } = getNotionConfig(range.periodType);
          if (!token || !databaseId) {
            errors.push(`Missing Notion config for ${range.periodType}`);
            continue;
          }

          // Check Prep tab and Review tab independently against empty + default-template guard
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

        // Also push Trade Notes in range if "trades" selected
        if (targets.includes("trades")) {
          const tradeRows = db
            .prepare(
              `SELECT key, symbol, notes, review_notes, notion_page_id
               FROM trades
               WHERE substr(opened_at, 1, 10) >= ? AND substr(opened_at, 1, 10) <= ?`
            )
            .all(startDate, endDate) as any[];

          const token = process.env.NOTION_TOKEN || "";
          for (const tr of tradeRows) {
            const combinedHtml = [tr.notes, tr.review_notes].filter(Boolean).join("<hr/>");
            if (!isSubstantiveJournalContent(combinedHtml, templateNormSet)) {
              skippedEmptyOrTemplate++;
              continue;
            }
            if (tr.notion_page_id && token) {
              try {
                const blockTree = await editorHtmlToNotionTree(combinedHtml, token);
                if (blockTree.length > 0) {
                  await clearNotionPageBlocks(tr.notion_page_id, token);
                  await appendBlocksTreeRecursive(tr.notion_page_id, blockTree, token);
                  pushedPages++;
                }
              } catch {}
            } else {
              skippedEmptyOrTemplate++;
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
        message: `Synced ${pushedPages} substantive page(s) to Notion. Skipped ${skippedEmptyOrTemplate} empty or unmodified default-template page(s) to protect cloud backups.`,
      });
    }

    // ==========================================================================
    // ACTION 2: DELETE LOCAL DATA IN DATE RANGE + VACUUM
    // ==========================================================================
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
        // 1. Delete Trades in range
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

        // 2. Delete Daily / Periodic Journals in range
        if (targets.includes("daily") || targets.includes("periodic")) {
          const allEntries = db.prepare(`SELECT slug, period_type, notion_page_id FROM journal_entries`).all() as any[];
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

        // 3. Delete Candlesticks / Excursions in range
        if (targets.includes("candles")) {
          try {
            const exDel = db
              .prepare(
                `DELETE FROM trade_excursions
                 WHERE substr(fetched_at, 1, 10) >= ? AND substr(fetched_at, 1, 10) <= ?`
              )
              .run(startDate, endDate);
            deletedCounts.candles += exDel.changes;
          } catch {}

          try {
            const startEpoch = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
            const endEpoch = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);
            const csvDel = db
              .prepare(
                `DELETE FROM market_csv_datasets
                 WHERE (first_time >= ? AND last_time <= ?)
                    OR (substr(imported_at, 1, 10) >= ? AND substr(imported_at, 1, 10) <= ?)`
              )
              .run(startEpoch, endEpoch, startDate, endDate);
            deletedCounts.candles += csvDel.changes;
          } catch {}
        }

        // Reclaim SQLite disk space immediately
        db.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
        db.exec(`VACUUM;`);
      } finally {
        db.close();
      }

      return NextResponse.json({
        ok: true,
        deletedCounts,
        message: `Deleted ${deletedCounts.trades} trades, ${deletedCounts.daily} daily journals, ${deletedCounts.periodic} periodic journals, and ${deletedCounts.candles} candle caches. Database vacuumed.`,
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

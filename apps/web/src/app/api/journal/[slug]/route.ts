import { NextRequest, NextResponse } from "next/server";
import { readFilters, computeMetrics, dayKeyOf, intradayCurve } from "@luxalgo/journal-core";
import { eq } from "drizzle-orm";
import { db, executions, journalDays } from "@/db";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades } from "@/server/trades-query";
import {
  getJournalEntryWithTrades,
  saveJournalEntry,
} from "@/server/journal-service";
import {
  getNotionConfig,
  fetchNotionBlocksRecursive,
  clearNotionPageBlocks,
  notionBlocksToHtml,
  editorHtmlToNotionTree,
  appendBlocksTreeRecursive,
  findNotionPageInDb,
} from "@/server/notion-sync";

type Params = { params: Promise<{ slug?: string; date?: string }> };

export const GET = handler(async (request: Request, { params }: Params) => {
  const resolved = await params;
  const slug = resolved.slug || resolved.date || "";
  const url = new URL(request.url);
  const timeZone = getTimeZone();

  const { entry, trades: periodTrades, range } = await getJournalEntryWithTrades(slug);

  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(slug);
  let legacyMetrics = null;
  let legacyTrades: any[] = [];
  let legacyCurve: any[] = [];
  let legacyNote = null;

  if (isDate) {
    const { rows, trades } = queryTrades(readFilters(url.searchParams));
    const dayTradeIndexes = trades
      .map((trade, index) => ({ trade, index }))
      .filter(({ trade }) => trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === slug);
    const dayTrades = dayTradeIndexes.map(({ trade }) => trade);

    const times = new Map<string, string>();
    for (const accountId of new Set(dayTrades.map((trade) => trade.accountId))) {
      const fills = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
      for (const fill of fills) times.set(fill.id, fill.executedAt);
    }

    legacyNote = db.select().from(journalDays).where(eq(journalDays.date, slug)).get() ?? null;
    legacyMetrics = computeMetrics(dayTrades, { timeZone });
    legacyTrades = dayTradeIndexes.map(({ index }) => rows[index]);
    legacyCurve = intradayCurve(dayTrades, times, slug, timeZone);
  }

  return ok({
    date: slug,
    slug,
    entry,
    range,
    journalTrades: periodTrades,
    metrics: legacyMetrics,
    trades: isDate ? legacyTrades : periodTrades,
    curve: legacyCurve,
    note: legacyNote,
  });
});

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const resolved = await params;
    const slug = resolved.slug || resolved.date || "";
    const body = await req.json();

    const { trades, range } = await getJournalEntryWithTrades(slug);
    const { token, databaseId } = getNotionConfig(range.periodType);

    // 1. PULL FROM NOTION
    if (body.pullFromNotion) {
      if (!token || !databaseId) {
        return NextResponse.json({
          notionSynced: false,
          notionError: `Missing NOTION_TOKEN or database ID for ${range.periodType} in .env.local`,
        });
      }

      let pageId = body.notionPageId;
      let pageUrl = body.notionUrl;
      let pageTitle = body.title || range.defaultTitle;

      if (!pageId) {
        const found = await findNotionPageInDb(databaseId, token, slug, pageTitle);
        if (!found.page) {
          return NextResponse.json({
            notionSynced: false,
            notionError: `No matching page found in Notion for "${slug}". Push to Notion first to create it.`,
          });
        }
        pageId = found.page.id;
        pageUrl = found.page.url;
        const titleArr = found.page.properties?.[found.titleProp]?.title;
        if (titleArr && titleArr.length) {
          pageTitle = titleArr.map((t: any) => t.plain_text).join("");
        }
      }

      const blocks = await fetchNotionBlocksRecursive(pageId, token);
      const htmlContent = await notionBlocksToHtml(blocks, slug);

      const entry = await saveJournalEntry(slug, {
        title: pageTitle,
        content: htmlContent,
        notionPageId: pageId,
        notionUrl: pageUrl,
      });

      return NextResponse.json({ entry, notionPulled: true });
    }

    // 2. SAVE LOCALLY
    let entry = await saveJournalEntry(slug, body);

    // 3. PUSH TO NOTION
    if (body.syncNotion) {
      if (!token || !databaseId) {
        return NextResponse.json({
          entry,
          notionSynced: false,
          notionError: `Missing NOTION_TOKEN or Database ID for ${range.periodType} in .env.local`,
        });
      }

      try {
        const netPnl = trades.reduce((acc, t) => acc + t.netPnl, 0);
        const found = await findNotionPageInDb(databaseId, token, slug, entry.title || slug);
        const availableProps = found.availableProps;
        const titlePropName = found.titleProp;

        const properties: Record<string, any> = {
          [titlePropName]: {
            title: [{ text: { content: entry.title || slug } }],
          },
        };

        if ("Slug" in availableProps && availableProps["Slug"].type === "rich_text") {
          properties["Slug"] = { rich_text: [{ text: { content: slug } }] };
        }
        if ("Period" in availableProps && availableProps["Period"].type === "select") {
          properties["Period"] = { select: { name: range.periodType.toUpperCase() } };
        }
        if ("HTF Bias" in availableProps && entry.marketBias) {
          if (availableProps["HTF Bias"].type === "select") {
            properties["HTF Bias"] = { select: { name: entry.marketBias } };
          } else if (availableProps["HTF Bias"].type === "rich_text") {
            properties["HTF Bias"] = { rich_text: [{ text: { content: entry.marketBias } }] };
          }
        }
        if ("Net P&L" in availableProps && availableProps["Net P&L"].type === "number") {
          properties["Net P&L"] = { number: Number(netPnl.toFixed(2)) };
        }
        if ("Date" in availableProps && availableProps["Date"].type === "date") {
          properties["Date"] = { date: { start: range.startDate } };
        }
        if ("Open Date" in availableProps && availableProps["Open Date"].type === "date") {
          properties["Open Date"] = { date: { start: range.startDate } };
        }

        const blockTree = await editorHtmlToNotionTree(entry.content);
        let targetPageId = entry.notionPageId || found.page?.id;
        let targetPageUrl = found.page?.url || entry.notionUrl;

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

          if (!createRes.ok) {
            const errText = await createRes.text();
            return NextResponse.json({
              entry,
              notionSynced: false,
              notionError: `Notion Page Error (${createRes.status}): ${errText.slice(0, 180)}`,
            });
          }

          const createdData = await createRes.json();
          targetPageId = createdData.id;
          targetPageUrl = createdData.url;

          if (targetPageId && blockTree.length > 0) {
            await appendBlocksTreeRecursive(targetPageId, blockTree, token);
          }
        }

        entry = await saveJournalEntry(slug, {
          notionPageId: targetPageId,
          notionUrl: targetPageUrl,
        });

        return NextResponse.json({ entry, notionSynced: true });
      } catch (syncErr: any) {
        console.error("Notion sync error:", syncErr);
        return NextResponse.json({
          entry,
          notionSynced: false,
          notionError: syncErr?.message || "Failed to push blocks to Notion",
        });
      }
    }

    return NextResponse.json({ entry, notionSynced: false });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to sync journal entry" },
      { status: 500 }
    );
  }
}

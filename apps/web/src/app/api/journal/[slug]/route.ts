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

function htmlToNotionBlocks(html: string): any[] {
  if (!html || !html.trim()) return [];

  const blocks: any[] = [];
  const clean = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  // Simple parser to extract Notion blocks based on data-notion-type and HTML tags
  const blockMatches = clean.match(
    /<(div|p|h1|h2|h3|blockquote|hr|figure|table)[\s\S]*?<\/\1>|<hr[^>]*\/?>|<(div|figure)[^>]*\/>/gi
  );

  const stripTags = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

  if (blockMatches) {
    for (const rawBlock of blockMatches) {
      const text = stripTags(rawBlock);
      if (!text && !rawBlock.includes("<hr") && !rawBlock.includes("img")) continue;

      if (rawBlock.includes('data-notion-type="heading_1"') || rawBlock.startsWith("<h1")) {
        blocks.push({
          object: "block",
          type: "heading_1",
          heading_1: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
        });
      } else if (rawBlock.includes('data-notion-type="heading_2"') || rawBlock.startsWith("<h2")) {
        blocks.push({
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
        });
      } else if (rawBlock.includes('data-notion-type="heading_3"') || rawBlock.startsWith("<h3")) {
        blocks.push({
          object: "block",
          type: "heading_3",
          heading_3: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
        });
      } else if (rawBlock.includes('data-notion-type="callout"') || rawBlock.includes("tz-callout")) {
        const iconMatch = rawBlock.match(/data-icon="([^"]+)"/);
        const icon = iconMatch ? iconMatch[1] : "💡";
        blocks.push({
          object: "block",
          type: "callout",
          callout: {
            icon: { emoji: icon },
            rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }],
          },
        });
      } else if (rawBlock.includes('data-notion-type="quote"') || rawBlock.startsWith("<blockquote")) {
        blocks.push({
          object: "block",
          type: "quote",
          quote: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
        });
      } else if (rawBlock.includes('data-notion-type="divider"') || rawBlock.includes("<hr")) {
        blocks.push({
          object: "block",
          type: "divider",
          divider: {},
        });
      } else if (rawBlock.includes('data-notion-type="to_do"') || rawBlock.includes("tz-check-row")) {
        const isChecked = rawBlock.includes('checked="checked"') || rawBlock.includes("checked");
        blocks.push({
          object: "block",
          type: "to_do",
          to_do: {
            rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }],
            checked: isChecked,
          },
        });
      } else if (rawBlock.includes('data-notion-type="toggle"') || rawBlock.includes("tz-toggle")) {
        blocks.push({
          object: "block",
          type: "toggle",
          toggle: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
        });
      } else {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
        });
      }
    }
  }

  if (blocks.length === 0) {
    const fallbackText = stripTags(html);
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: (fallbackText || "Empty journal entry.").slice(0, 1900) } },
        ],
      },
    });
  }

  return blocks;
}

export async function PUT(
  req: NextRequest,
  { params }: Params
) {
  try {
    const resolved = await params;
    const slug = resolved.slug || resolved.date || "";
    const body = await req.json();

    let entry = await saveJournalEntry(slug, body);

    if (body.syncNotion) {
      const notionToken = process.env.NOTION_TOKEN;
      const notionDbId =
        process.env.NOTION_JOURNAL_DATABASE_ID || process.env.NOTION_DATABASE_ID;

      if (!notionToken || !notionDbId) {
        return NextResponse.json(
          {
            entry,
            notionSynced: false,
            notionError:
              "Missing NOTION_TOKEN or NOTION_JOURNAL_DATABASE_ID in environment.",
          },
          { status: 200 }
        );
      }

      const { trades, range } = await getJournalEntryWithTrades(slug);
      const netPnl = trades.reduce((acc, t) => acc + t.netPnl, 0);

      const summaryLines = [
        `Period: ${range.periodType.toUpperCase()} (${range.startDate} to ${range.endDate})`,
        `Net P&L: $${netPnl.toFixed(2)} | Trades: ${trades.length}`,
        entry.marketBias ? `HTF Bias: ${entry.marketBias}` : "",
        entry.dayProfile ? `Day Profile: ${entry.dayProfile}` : "",
        entry.keyLevels ? `Key Levels / DOL: ${entry.keyLevels}` : "",
        entry.lessonsLearned ? `Key Takeaway: ${entry.lessonsLearned}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const bodyBlocks = htmlToNotionBlocks(entry.content);

      const childrenBlocks = [
        {
          object: "block",
          type: "callout",
          callout: {
            rich_text: [{ type: "text", text: { content: summaryLines } }],
            icon: { emoji: "📊" },
          },
        },
        ...bodyBlocks,
      ];

      const schemaRes = await fetch(
        `https://api.notion.com/v1/databases/${notionDbId}`,
        {
          headers: {
            Authorization: `Bearer ${notionToken}`,
            "Notion-Version": "2022-06-28",
          },
        }
      );

      let titlePropName = "Name";
      let availableProps: Record<string, any> = {};
      if (schemaRes.ok) {
        const dbMeta = await schemaRes.json();
        availableProps = dbMeta.properties || {};
        for (const [k, v] of Object.entries(availableProps)) {
          if ((v as any).type === "title") {
            titlePropName = k;
            break;
          }
        }
      }

      const properties: Record<string, any> = {
        [titlePropName]: {
          title: [{ text: { content: entry.title || slug } }],
        },
      };

      if ("Net P&L" in availableProps && availableProps["Net P&L"].type === "number") {
        properties["Net P&L"] = { number: Number(netPnl.toFixed(2)) };
      }
      if ("Open Date" in availableProps && availableProps["Open Date"].type === "date") {
        properties["Open Date"] = { date: { start: range.startDate } };
      }
      if ("Date" in availableProps && availableProps["Date"].type === "date") {
        properties["Date"] = { date: { start: range.startDate } };
      }

      if (entry.notionPageId) {
        const updateRes = await fetch(
          `https://api.notion.com/v1/pages/${entry.notionPageId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${notionToken}`,
              "Notion-Version": "2022-06-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ properties }),
          }
        );

        if (updateRes.ok) {
          const data = await updateRes.json();
          entry = await saveJournalEntry(slug, {
            notionPageId: data.id,
            notionUrl: data.url,
          });
          return NextResponse.json({ entry, notionSynced: true });
        }
      }

      const createRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: notionDbId },
          properties,
          children: childrenBlocks.slice(0, 100),
        }),
      });

      if (createRes.ok) {
        const data = await createRes.json();
        entry = await saveJournalEntry(slug, {
          notionPageId: data.id,
          notionUrl: data.url,
        });
        return NextResponse.json({ entry, notionSynced: true });
      } else {
        const errText = await createRes.text();
        return NextResponse.json({
          entry,
          notionSynced: false,
          notionError: `Notion API (${createRes.status}): ${errText.slice(0, 180)}`,
        });
      }
    }

    return NextResponse.json({ entry, notionSynced: false });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to save journal entry" },
      { status: 500 }
    );
  }
}

import { eq, sql } from "drizzle-orm";
import { db, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";
import { tradeR } from "@luxalgo/journal-core";
import { pullFromNotionPage, pushHtmlToNotionPage } from "@/server/notion-sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ key: string }> };

function ensureNotionColumns() {
  try {
    db.run(sql`ALTER TABLE trades ADD COLUMN notion_page_id TEXT`);
  } catch {}
  try {
    db.run(sql`ALTER TABLE trades ADD COLUMN notion_url TEXT`);
  } catch {}
  try {
    db.run(sql`ALTER TABLE trades ADD COLUMN review_notes TEXT DEFAULT ''`);
  } catch {}
}

async function createNotionTradePageIfNeeded(decodedKey: string, row: any, token: string, tradesDbId: string) {
  try {
    const dbRes = await fetch(`[https://api.notion.com/v1/databases/$](https://api.notion.com/v1/databases/$){tradesDbId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!dbRes.ok) return null;
    const dbMeta = await dbRes.json();
    const availableProps = dbMeta.properties || {};

    let titleProp = "Name";
    for (const [k, v] of Object.entries(availableProps)) {
      if ((v as any).type === "title") {
        titleProp = k;
        break;
      }
    }

    const tradeObj = rowToTrade(row);
    const rVal = tradeR(tradeObj);
    const dateStr = (row.openedAt || new Date().toISOString()).slice(0, 10);
    const titleText = `${row.symbol} ${(row.direction || "LONG").toUpperCase()} (${dateStr})`;

    const properties: Record<string, any> = {
      [titleProp]: {
        title: [{ text: { content: titleText } }],
      },
    };

    if ("LuxAlgo ID" in availableProps && availableProps["LuxAlgo ID"].type === "rich_text") {
      properties["LuxAlgo ID"] = { rich_text: [{ text: { content: decodedKey } }] };
    }
    if ("Symbol" in availableProps) {
      if (availableProps["Symbol"].type === "select") {
        properties["Symbol"] = { select: { name: String(row.symbol || "NAS100") } };
      } else if (availableProps["Symbol"].type === "rich_text") {
        properties["Symbol"] = { rich_text: [{ text: { content: String(row.symbol || "") } }] };
      }
    }
    for (const sideKey of ["Direction", "Side", "Type"]) {
      if (sideKey in availableProps && availableProps[sideKey].type === "select") {
        properties[sideKey] = { select: { name: String(row.direction || "long").toUpperCase() } };
      }
    }
    for (const pnlKey of ["Net P&L", "Net PnL", "PnL", "P&L"]) {
      if (pnlKey in availableProps && availableProps[pnlKey].type === "number") {
        properties[pnlKey] = { number: Number((row.netPnl || 0).toFixed(2)) };
      }
    }
    for (const rKey of ["Realized R", "R", "R Multiple"]) {
      if (rKey in availableProps && availableProps[rKey].type === "number" && rVal != null) {
        properties[rKey] = { number: Number(rVal.toFixed(2)) };
      }
    }
    for (const dtKey of ["Date", "Open Date", "Opened At"]) {
      if (dtKey in availableProps && availableProps[dtKey].type === "date" && row.openedAt) {
        properties[dtKey] = { date: { start: row.openedAt } };
      }
    }

    const createRes = await fetch("[https://api.notion.com/v1/pages](https://api.notion.com/v1/pages)", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: tradesDbId },
        properties,
      }),
    });

    if (!createRes.ok) return null;
    const created = await createRes.json();
    if (created?.id) {
      const pageId = created.id;
      const notionUrl = created.url || `[https://www.notion.so/$](https://www.notion.so/$){created.id.replace(/-/g, "")}`;
      db.run(
        sql`UPDATE trades SET notion_page_id = ${pageId}, notion_url = ${notionUrl} WHERE key = ${decodedKey}`
      );
      return { pageId, notionUrl };
    }
  } catch (err) {
    console.warn("Auto-create Notion trade page failed:", err);
  }
  return null;
}

async function resolveTradePage(decodedKey: string, token: string, autoCreate = true) {
  ensureNotionColumns();

  const row = getTradeByKey(decodedKey) as any;
  if (!row) return null;

  const rawRows = db.all(
    sql`SELECT notion_page_id AS notionPageId, notion_url AS notionUrl, review_notes AS reviewNotes FROM trades WHERE key = ${decodedKey} LIMIT 1`
  ) as any[];
  const raw = rawRows?.[0] || {};

  let pageId: string | null = row.notionPageId || row.notion_page_id || raw.notionPageId || null;
  let notionUrl: string | null = row.notionUrl || row.notion_url || raw.notionUrl || null;

  const tradesDbId = (
    process.env.NOTION_TRADES_DATABASE_ID ||
    process.env.NOTION_DATABASE_ID ||
    ""
  ).replace(/-/g, "");

  if (!pageId && tradesDbId && token) {
    try {
      const res = await fetch(`[https://api.notion.com/v1/databases/$](https://api.notion.com/v1/databases/$){tradesDbId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            property: "LuxAlgo ID",
            rich_text: { equals: decodedKey },
          },
          page_size: 1,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const page = data.results?.[0];
        if (page?.id) {
          pageId = page.id;
          notionUrl = page.url || `[https://www.notion.so/$](https://www.notion.so/$){page.id.replace(/-/g, "")}`;
          db.run(
            sql`UPDATE trades SET notion_page_id = ${pageId}, notion_url = ${notionUrl} WHERE key = ${decodedKey}`
          );
        }
      }
    } catch (err) {
      console.warn("Failed to query Notion for trade page:", err);
    }
  }

  if (!pageId && autoCreate && tradesDbId && token) {
    const created = await createNotionTradePageIfNeeded(decodedKey, row, token, tradesDbId);
    if (created) {
      pageId = created.pageId;
      notionUrl = created.notionUrl;
    }
  }

  if (pageId && !notionUrl) {
    notionUrl = `[https://www.notion.so/$](https://www.notion.so/$){pageId.replace(/-/g, "")}`;
  }

  return {
    row,
    pageId,
    notionUrl,
    rawReviewNotes: raw.reviewNotes || row.review_notes || row.reviewNotes || "",
  };
}

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const token = process.env.NOTION_TOKEN || "";

  if (!token) return bad("Missing NOTION_TOKEN in server environment (.env)", 400);

  const resolved = await resolveTradePage(decodedKey, token, true);
  if (!resolved) return bad(`Trade '${decodedKey}' not found`, 404);
  if (!resolved.pageId) return bad(`No linked Notion page found for trade '${decodedKey}'`, 404);

  const html = await pullFromNotionPage(resolved.pageId, token, decodedKey);
  db.update(trades).set({ notes: html }).where(eq(trades.key, decodedKey)).run();

  return ok({
    ok: true,
    notes: html,
    notionPageId: resolved.pageId,
    notionUrl: resolved.notionUrl,
  });
});

export const POST = handler(async (request: Request, { params }: Params) => {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const token = process.env.NOTION_TOKEN || "";

  if (!token) return bad("Missing NOTION_TOKEN in server environment (.env)", 400);

  const body = (await request.json().catch(() => ({}))) as {
    notes?: string;
    reviewNotes?: string;
  };

  ensureNotionColumns();

  if (body.reviewNotes !== undefined) {
    db.run(
      sql`UPDATE trades SET review_notes = ${body.reviewNotes}, reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP) WHERE key = ${decodedKey}`
    );
  }
  if (body.notes !== undefined) {
    db.run(sql`UPDATE trades SET notes = ${body.notes} WHERE key = ${decodedKey}`);
  }

  const resolved = await resolveTradePage(decodedKey, token, true);
  if (!resolved) return bad(`Trade '${decodedKey}' not found`, 404);
  if (!resolved.pageId) return bad(`Could not find or create Notion page for trade '${decodedKey}'`, 404);

  const row = getTradeByKey(decodedKey) as any;
  const currentNotes = (typeof body.notes === "string" ? body.notes : (row?.notes || "")).trim();
  const currentReview = (
    typeof body.reviewNotes === "string" ? body.reviewNotes : (resolved.rawReviewNotes || "")
  ).trim();

  let fullHtmlToPush = "";
  if (currentNotes && currentReview) {
    if (currentNotes.includes(currentReview)) {
      fullHtmlToPush = currentNotes;
    } else if (currentReview.includes(currentNotes)) {
      fullHtmlToPush = currentReview;
    } else {
      fullHtmlToPush = `${currentNotes}<p><br/></p><hr/><p><strong>Post-Trade Review</strong></p>${currentReview}`;
    }
  } else if (currentReview) {
    fullHtmlToPush = currentReview;
  } else {
    fullHtmlToPush = currentNotes;
  }

  if (fullHtmlToPush) {
    await pushHtmlToNotionPage(resolved.pageId, fullHtmlToPush, token);
  }

  try {
    const { patchNotionTradePage } = await import("@/lib/notion-sync");
    if (body.reviewNotes !== undefined) {
      void patchNotionTradePage(resolved.pageId, { reviewed: true });
    }
  } catch {}

  return ok({
    ok: true,
    notionPageId: resolved.pageId,
    notionUrl: resolved.notionUrl,
  });
});

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, trades } from "@/db";
import { pullFromNotionPage, pushHtmlToNotionPage } from "@/server/notion-sync";

function ensureNotionColumns() {
  try {
    db.run(sql`ALTER TABLE trades ADD COLUMN notion_page_id TEXT`);
  } catch {}
  try {
    db.run(sql`ALTER TABLE trades ADD COLUMN notion_url TEXT`);
  } catch {}
}

async function resolveTrade(decodedKey: string, token: string) {
  ensureNotionColumns();

  // Read directly via raw SQL so columns are guaranteed even if schema cache lags
  const rows = db.all(
    sql`SELECT key, notes, notion_page_id AS notionPageId, notion_url AS notionUrl FROM trades WHERE key = ${decodedKey} LIMIT 1`
  ) as any[];

  const row = rows?.[0];
  if (!row) return null;

  let pageId: string | null = row.notionPageId || null;
  let notionUrl: string | null = row.notionUrl || null;

  const tradesDbId = (
    process.env.NOTION_TRADES_DATABASE_ID ||
    process.env.NOTION_DATABASE_ID ||
    ""
  ).replace(/-/g, "");

  if (!pageId && tradesDbId && token) {
    try {
      const res = await fetch(`https://api.notion.com/v1/databases/${tradesDbId}/query`, {
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
          notionUrl = page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`;
          db.run(
            sql`UPDATE trades SET notion_page_id = ${pageId}, notion_url = ${notionUrl} WHERE key = ${decodedKey}`
          );
        }
      }
    } catch (err) {
      console.warn("Failed to query Notion for trade page:", err);
    }
  }

  return { row, pageId, notionUrl };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const decodedKey = decodeURIComponent(key);
    const token = process.env.NOTION_TOKEN || "";

    if (!token) {
      return NextResponse.json(
        { error: "Missing NOTION_TOKEN in server environment (.env)" },
        { status: 400 }
      );
    }

    const resolved = await resolveTrade(decodedKey, token);
    if (!resolved) {
      return NextResponse.json(
        { error: `Trade '${decodedKey}' not found in local SQLite database.` },
        { status: 404 }
      );
    }
    if (!resolved.pageId) {
      return NextResponse.json(
        { error: `No linked Notion page found in Notion for trade '${decodedKey}'.` },
        { status: 404 }
      );
    }

    const html = await pullFromNotionPage(resolved.pageId, token, decodedKey);
    db.run(sql`UPDATE trades SET notes = ${html} WHERE key = ${decodedKey}`);

    return NextResponse.json({
      ok: true,
      notes: html,
      notionPageId: resolved.pageId,
      notionUrl: resolved.notionUrl,
    });
  } catch (err: any) {
    console.error("Trade Notion GET error:", err);
    return NextResponse.json(
      { error: err?.message || String(err) || "Failed to pull notes from Notion" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const decodedKey = decodeURIComponent(key);
    const token = process.env.NOTION_TOKEN || "";

    if (!token) {
      return NextResponse.json(
        { error: "Missing NOTION_TOKEN in server environment (.env)" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const notesHtml = typeof body.notes === "string" ? body.notes : "";

    const resolved = await resolveTrade(decodedKey, token);
    if (!resolved) {
      return NextResponse.json(
        { error: `Trade '${decodedKey}' not found in local SQLite database.` },
        { status: 404 }
      );
    }
    if (!resolved.pageId) {
      return NextResponse.json(
        { error: `No linked Notion page found in Notion for trade '${decodedKey}'.` },
        { status: 404 }
      );
    }

    db.run(sql`UPDATE trades SET notes = ${notesHtml} WHERE key = ${decodedKey}`);
    await pushHtmlToNotionPage(resolved.pageId, notesHtml, token);

    return NextResponse.json({
      ok: true,
      notionPageId: resolved.pageId,
      notionUrl: resolved.notionUrl,
    });
  } catch (err: any) {
    console.error("Trade Notion POST error:", err);
    return NextResponse.json(
      { error: err?.message || String(err) || "Failed to sync notes to Notion" },
      { status: 500 }
    );
  }
}

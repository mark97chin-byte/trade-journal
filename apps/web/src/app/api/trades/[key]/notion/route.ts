import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, trades } from "@/db";
import { pullFromNotionPage, pushHtmlToNotionPage } from "@/server/notion-sync";

async function resolveTrade(decodedKey: string, token: string) {
  const row = db.select().from(trades).where(eq(trades.key, decodedKey)).get() as any;
  if (!row) return null;

  let pageId = row.notionPageId || row.notion_page_id;
  let notionUrl = row.notionUrl || row.notion_url;

  // Fallback lookup if not cached in SQLite
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
          db.update(trades)
            .set({ notionPageId: pageId, notionUrl } as any)
            .where(eq(trades.key, decodedKey))
            .run();
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
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const token = process.env.NOTION_TOKEN || "";
  if (!token) {
    return NextResponse.json({ error: "Missing NOTION_TOKEN in environment" }, { status: 400 });
  }

  try {
    const resolved = await resolveTrade(decodedKey, token);
    if (!resolved || !resolved.pageId) {
      return NextResponse.json(
        { error: "No Notion page found for this trade." },
        { status: 404 }
      );
    }

    const html = await pullFromNotionPage(resolved.pageId, token, decodedKey);
    db.update(trades)
      .set({ notes: html } as any)
      .where(eq(trades.key, decodedKey))
      .run();

    return NextResponse.json({
      ok: true,
      notes: html,
      notionPageId: resolved.pageId,
      notionUrl: resolved.notionUrl,
    });
  } catch (err: any) {
    console.error("Trade Notion pull error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to pull notes from Notion" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const token = process.env.NOTION_TOKEN || "";
  if (!token) {
    return NextResponse.json({ error: "Missing NOTION_TOKEN in environment" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const notesHtml = typeof body.notes === "string" ? body.notes : "";

  try {
    const resolved = await resolveTrade(decodedKey, token);
    if (!resolved || !resolved.pageId) {
      return NextResponse.json(
        { error: "No Notion page found for this trade." },
        { status: 404 }
      );
    }

    db.update(trades)
      .set({ notes: notesHtml } as any)
      .where(eq(trades.key, decodedKey))
      .run();

    await pushHtmlToNotionPage(resolved.pageId, notesHtml, token);

    return NextResponse.json({
      ok: true,
      notionPageId: resolved.pageId,
      notionUrl: resolved.notionUrl,
    });
  } catch (err: any) {
    console.error("Trade Notion sync error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to sync notes to Notion" },
      { status: 500 }
    );
  }
}

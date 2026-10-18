import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { pullFromNotionPage, pushHtmlToNotionPage } from "@/server/notion-sync";

function getSqliteDb() {
  const candidates = [
    path.join(process.cwd(), "data", "journal.db"),
    path.join(process.cwd(), "apps", "web", "data", "journal.db"),
  ];
  const dbPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  return new Database(dbPath);
}

async function resolveTradeNotionPage(db: any, key: string, token: string) {
  const row = db
    .prepare("SELECT key, symbol, notion_page_id, notion_url, notes FROM trades WHERE key = ?")
    .get(key) as any;

  if (!row) return null;

  let pageId = row.notion_page_id;
  let notionUrl = row.notion_url;

  // Fallback: query Notion Trades database by LuxAlgo ID if notion_page_id is missing in SQLite
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
            rich_text: { equals: key },
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
          db.prepare("UPDATE trades SET notion_page_id = ?, notion_url = ? WHERE key = ?").run(
            pageId,
            notionUrl,
            key
          );
        }
      }
    } catch (err) {
      console.warn("Could not look up trade page in Notion:", err);
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
    return NextResponse.json({ error: "Missing NOTION_TOKEN in .env" }, { status: 400 });
  }

  const db = getSqliteDb();
  try {
    const resolved = await resolveTradeNotionPage(db, decodedKey, token);
    if (!resolved || !resolved.pageId) {
      return NextResponse.json(
        { error: "No linked Notion page found for this trade." },
        { status: 404 }
      );
    }

    const html = await pullFromNotionPage(resolved.pageId, token, decodedKey);
    db.prepare("UPDATE trades SET notes = ? WHERE key = ?").run(html, decodedKey);

    return NextResponse.json({
      ok: true,
      notes: html,
      notionPageId: resolved.pageId,
      notionUrl: resolved.notionUrl,
    });
  } catch (err: any) {
    console.error("Failed to pull trade notes from Notion:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to pull from Notion" },
      { status: 500 }
    );
  } finally {
    db.close();
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
    return NextResponse.json({ error: "Missing NOTION_TOKEN in .env" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const notesHtml = typeof body.notes === "string" ? body.notes : "";

  const db = getSqliteDb();
  try {
    const resolved = await resolveTradeNotionPage(db, decodedKey, token);
    if (!resolved || !resolved.pageId) {
      return NextResponse.json(
        { error: "No linked Notion page found for this trade." },
        { status: 404 }
      );
    }

    db.prepare("UPDATE trades SET notes = ? WHERE key = ?").run(notesHtml, decodedKey);
    await pushHtmlToNotionPage(resolved.pageId, notesHtml, token);

    return NextResponse.json({
      ok: true,
      notionPageId: resolved.pageId,
      notionUrl: resolved.notionUrl,
    });
  } catch (err: any) {
    console.error("Failed to sync trade notes to Notion:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to sync to Notion" },
      { status: 500 }
    );
  } finally {
    db.close();
  }
}

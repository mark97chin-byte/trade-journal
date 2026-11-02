import { Suspense } from "react";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  getJournalTrades,
  ensureJournalSchema,
  getJournalConfig,
} from "@/server/journal-service";
import { JournalView } from "@/components/journal/journal-view";
import { Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";

function normalizeText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getActiveJournalSlugs(): string[] {
  try {
    const dbPath = path.resolve(process.cwd(), "data", "journal.db");
    const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
    const target = fs.existsSync(dbPath) ? dbPath : altDbPath;
    if (!fs.existsSync(target)) return [];

    // Build set of normalized default template texts so unmodified templates count as empty
    const cfg = getJournalConfig();
    const templateFingerprints = new Set<string>();
    for (const tpl of ((cfg.templates as any[]) || [])) {
      const raw = tpl.content || tpl.html || tpl.template || "";
      const norm = normalizeText(raw);
      if (norm) templateFingerprints.add(norm);
    }

    const db = new Database(target);
    try {
      ensureJournalSchema(db);
      const rows = db
        .prepare(
          `SELECT slug, content, review_content, lessons_learned FROM journal_entries`
        )
        .all() as Array<{
        slug: string;
        content: string | null;
        review_content: string | null;
        lessons_learned: string | null;
      }>;
      const active: string[] = [];
      for (const r of rows) {
        const c = normalizeText(r.content);
        const rev = normalizeText(r.review_content);
        const les = (r.lessons_learned || "").trim();

        const hasCustomPrep = c.length > 0 && !templateFingerprints.has(c);
        const hasCustomRev = rev.length > 0 && !templateFingerprints.has(rev);

        if (hasCustomPrep || hasCustomRev || les.length > 0) {
          active.push(r.slug);
        }
      }
      return active;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export default async function JournalPage() {
  const trades = await getJournalTrades();
  const activeEntrySlugs = getActiveJournalSlugs();

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        }
      >
        <JournalView trades={trades} activeEntrySlugs={activeEntrySlugs} />
      </Suspense>
    </div>
  );
}

import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { ensureJournalSchema } from "@/server/journal-service";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function getMondayStr(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

export interface SubEntryPreview {
  slug: string;
  shortLabel: string;
  fullTitle: string;
  level: "day" | "week" | "month" | "quarter";
  content: string;
  reviewContent: string;
  lessonsLearned: string;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const periodType = url.searchParams.get("periodType") || "week";
    const startDate = url.searchParams.get("start") || "";
    const endDate = url.searchParams.get("end") || "";
    const anchorDate = url.searchParams.get("anchor") || startDate;

    const targetList: Array<{ slug: string; shortLabel: string; fullTitle: string; level: SubEntryPreview["level"] }> = [];

    if (periodType === "week") {
      // Monday through Friday of that week
      const mon = new Date(`${anchorDate}T12:00:00Z`);
      const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      for (let i = 0; i < 5; i++) {
        const d = new Date(mon.getTime() + i * 86_400_000);
        const dStr = d.toISOString().slice(0, 10);
        targetList.push({
          slug: dStr,
          shortLabel: `${dayNames[i]} (${dStr.slice(8)})`,
          fullTitle: `Daily Journal — ${dStr}`,
          level: "day",
        });
      }
    } else if (periodType === "month") {
      // All weeks in this month + all trading days in this month
      const start = new Date(`${startDate}T12:00:00Z`);
      const end = new Date(`${endDate}T12:00:00Z`);
      const seenWeeks = new Set<string>();
      let wkCount = 1;
      for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
        const d = new Date(t);
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        const dStr = d.toISOString().slice(0, 10);
        const monStr = getMondayStr(dStr);
        if (!seenWeeks.has(monStr)) {
          seenWeeks.add(monStr);
          targetList.push({
            slug: `week-${monStr}`,
            shortLabel: `Wk ${wkCount++} (${monStr.slice(5)})`,
            fullTitle: `Weekly Journal (${monStr})`,
            level: "week",
          });
        }
        targetList.push({
          slug: dStr,
          shortLabel: dStr.slice(5),
          fullTitle: `Daily Journal — ${dStr}`,
          level: "day",
        });
      }
    } else if (periodType === "quarter") {
      // 3 Months in the quarter + Weeks
      const start = new Date(`${startDate}T12:00:00Z`);
      const yr = start.getUTCFullYear();
      const startMo = start.getUTCMonth() + 1;
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      for (let i = 0; i < 3; i++) {
        const mNum = startMo + i;
        const mKey = `${yr}-${String(mNum).padStart(2, "0")}`;
        targetList.push({
          slug: `month-${mKey}`,
          shortLabel: monthNames[mNum - 1] || mKey,
          fullTitle: `Monthly Journal (${mKey})`,
          level: "month",
        });
      }
      const end = new Date(`${endDate}T12:00:00Z`);
      const seenWeeks = new Set<string>();
      for (let t = start.getTime(); t <= end.getTime(); t += 7 * 86_400_000) {
        const dStr = new Date(t).toISOString().slice(0, 10);
        const monStr = getMondayStr(dStr);
        if (!seenWeeks.has(monStr)) {
          seenWeeks.add(monStr);
          targetList.push({
            slug: `week-${monStr}`,
            shortLabel: `Wk ${monStr.slice(5)}`,
            fullTitle: `Weekly Journal (${monStr})`,
            level: "week",
          });
        }
      }
    } else if (periodType === "year") {
      const yr = anchorDate.slice(0, 4);
      for (let q = 1; q <= 4; q++) {
        targetList.push({
          slug: `quarter-${yr}-Q${q}`,
          shortLabel: `Q${q} ${yr}`,
          fullTitle: `Quarterly Journal (${yr}-Q${q})`,
          level: "quarter",
        });
      }
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      for (let m = 1; m <= 12; m++) {
        const mKey = `${yr}-${String(m).padStart(2, "0")}`;
        targetList.push({
          slug: `month-${mKey}`,
          shortLabel: monthNames[m - 1]!,
          fullTitle: `Monthly Journal (${mKey})`,
          level: "month",
        });
      }
    }

    const dbPath = resolveDbPath();
    const rowMap = new Map<string, any>();

    if (fs.existsSync(dbPath) && targetList.length > 0) {
      const db = new Database(dbPath, { readonly: true });
      try {
        ensureJournalSchema(db);
        const placeholders = targetList.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT slug, title, content, review_content, lessons_learned
             FROM journal_entries
             WHERE slug IN (${placeholders})`
          )
          .all(...targetList.map((t) => t.slug)) as any[];
        for (const r of rows) {
          rowMap.set(r.slug, r);
        }
      } catch {
      } finally {
        db.close();
      }
    }

    const results: SubEntryPreview[] = targetList.map((item) => {
      const found = rowMap.get(item.slug);
      return {
        slug: item.slug,
        shortLabel: item.shortLabel,
        fullTitle: found?.title || item.fullTitle,
        level: item.level,
        content: found?.content || "",
        reviewContent: found?.review_content || "",
        lessonsLearned: found?.lessons_learned || "",
      };
    });

    return NextResponse.json({ subEntries: results });
  } catch (err: any) {
    return NextResponse.json(
      { subEntries: [], error: err?.message || "Failed to fetch subentries" },
      { status: 500 }
    );
  }
}

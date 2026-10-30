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
  level: "day" | "week" | "month" | "quarter" | "year";
  isSelfPeriod?: boolean;
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

    const targetList: Array<{
      slug: string;
      shortLabel: string;
      fullTitle: string;
      level: SubEntryPreview["level"];
      isSelfPeriod?: boolean;
    }> = [];

    if (periodType === "day") {
      targetList.push({
        slug: anchorDate,
        shortLabel: `Daily Analysis (${anchorDate.slice(5)})`,
        fullTitle: `Daily Journal — ${anchorDate}`,
        level: "day",
        isSelfPeriod: true,
      });
    } else if (periodType === "week") {
      const monStr = getMondayStr(anchorDate);
      // 1. Weekly Analysis tab for this week itself
      targetList.push({
        slug: `week-${monStr}`,
        shortLabel: `Weekly Analysis (${monStr.slice(5)})`,
        fullTitle: `Weekly Journal (${monStr})`,
        level: "week",
        isSelfPeriod: true,
      });
      // 2. Monday through Friday Daily Notes of that week
      const mon = new Date(`${monStr}T12:00:00Z`);
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
      const moKey = anchorDate.slice(0, 7);
      // 1. Monthly Analysis tab for this month itself
      targetList.push({
        slug: `month-${moKey}`,
        shortLabel: `Monthly Analysis (${moKey})`,
        fullTitle: `Monthly Journal (${moKey})`,
        level: "month",
        isSelfPeriod: true,
      });
      // 2. All weeks & trading days in this month
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
      const start = new Date(`${startDate}T12:00:00Z`);
      const yr = start.getUTCFullYear();
      const startMo = start.getUTCMonth() + 1;
      const qNum = Math.floor((startMo - 1) / 3) + 1;
      const qSlug = `quarter-${yr}-Q${qNum}`;
      // 1. Quarterly Analysis tab for this quarter itself
      targetList.push({
        slug: qSlug,
        shortLabel: `Quarterly Analysis (${yr}-Q${qNum})`,
        fullTitle: `Quarterly Journal (${yr}-Q${qNum})`,
        level: "quarter",
        isSelfPeriod: true,
      });
      // 2. 3 Months in the quarter + Weeks
      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
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
      // 1. Yearly Analysis tab for this year itself
      targetList.push({
        slug: `year-${yr}`,
        shortLabel: `Yearly Analysis (${yr})`,
        fullTitle: `Annual Journal (${yr})`,
        level: "year",
        isSelfPeriod: true,
      });
      for (let q = 1; q <= 4; q++) {
        targetList.push({
          slug: `quarter-${yr}-Q${q}`,
          shortLabel: `Q${q} ${yr}`,
          fullTitle: `Quarterly Journal (${yr}-Q${q})`,
          level: "quarter",
        });
      }
      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
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
    const tradeReviews: Record<string, { notes: string; reviewNotes: string }> = {};

    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        ensureJournalSchema(db);
        try {
          db.exec(`ALTER TABLE trades ADD COLUMN review_notes TEXT DEFAULT ''`);
        } catch {}

        if (targetList.length > 0) {
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
        }

        const tRows = db
          .prepare(`SELECT key, notes, review_notes FROM trades`)
          .all() as Array<{ key: string; notes: string | null; review_notes: string | null }>;
        for (const tr of tRows) {
          tradeReviews[tr.key] = {
            notes: tr.notes || "",
            reviewNotes: tr.review_notes || "",
          };
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
        isSelfPeriod: item.isSelfPeriod,
        content: found?.content || "",
        reviewContent: found?.review_content || "",
        lessonsLearned: found?.lessons_learned || "",
      };
    });

    return NextResponse.json({ subEntries: results, tradeReviews });
  } catch (err: any) {
    return NextResponse.json(
      { subEntries: [], tradeReviews: {}, error: err?.message || "Failed to fetch subentries" },
      { status: 500 }
    );
  }
}

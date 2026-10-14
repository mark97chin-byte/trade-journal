import { sql, eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { queryTrades } from "@/server/trades-query";

export const tagCategories = sqliteTable("tag_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tagDefinitions = sqliteTable("tag_definitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: text("category_id"),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

const DEFAULT_CATEGORIES = [
  { id: "cat-930-function", name: "930 function", color: "#94a3b8" },
  { id: "cat-caution-protocol", name: "Caution protocol", color: "#dc2626" },
  { id: "cat-daily-framework", name: "Daily valid framework", color: "#10b981" },
  { id: "cat-entry-model", name: "Entry model", color: "#94a3b8" },
  { id: "cat-entry-timeframe", name: "Entry timeframe", color: "#94a3b8" },
  { id: "cat-session-profile", name: "Session profile", color: "#94a3b8" },
  { id: "cat-common-mistakes", name: "Common mistakes", color: "#f43f5e" },
];

const DEFAULT_TAGS: { name: string; categoryId: string; description?: string }[] = [
  { name: "1800 expansion", categoryId: "cat-session-profile" },
  { name: "london reversal", categoryId: "cat-session-profile" },
  { name: "ny continuation", categoryId: "cat-session-profile" },
  { name: "ny reversal", categoryId: "cat-session-profile" },
  { name: "m15", categoryId: "cat-entry-timeframe" },
  { name: "m3", categoryId: "cat-entry-timeframe" },
  { name: "m4", categoryId: "cat-entry-timeframe" },
  { name: "m5", categoryId: "cat-entry-timeframe" },
  { name: "continuation purge", categoryId: "cat-entry-model" },
  { name: "fvg ob", categoryId: "cat-entry-model" },
  { name: "pb", categoryId: "cat-entry-model" },
  { name: "confirmed protected swing", categoryId: "cat-daily-framework" },
  { name: "continuation day", categoryId: "cat-daily-framework" },
  { name: "opposing draw", categoryId: "cat-daily-framework" },
  { name: "short wick reversal", categoryId: "cat-daily-framework" },
  { name: "expansion rule", categoryId: "cat-caution-protocol" },
  { name: "neutral range", categoryId: "cat-caution-protocol" },
  { name: "930 continuation", categoryId: "cat-930-function" },
  { name: "930 manipulation", categoryId: "cat-930-function" },
];

export function extractTradeTokens(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap(extractTradeTokens);
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return extractTradeTokens(JSON.parse(trimmed));
      } catch {
        // fallback to comma split
      }
    }
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof val === "object" && val !== null) {
    if ("name" in val && typeof (val as any).name === "string") return [(val as any).name.trim()];
    if ("tag" in val && typeof (val as any).tag === "string") return [(val as any).tag.trim()];
    if ("label" in val && typeof (val as any).label === "string") return [(val as any).label.trim()];
  }
  return [];
}

let initialized = false;

export function ensureTagsTables() {
  if (initialized) return;

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tag_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tag_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  const existingCats = db.select().from(tagCategories).all();
  if (existingCats.length === 0) {
    seedDefaultsAndSyncTrades();
  }

  initialized = true;
}

export function seedDefaultsAndSyncTrades() {
  const now = new Date().toISOString();
  const existingCats = db.select().from(tagCategories).all();
  const catById = new Map(existingCats.map((c) => [c.id, c]));

  for (const defCat of DEFAULT_CATEGORIES) {
    if (!catById.has(defCat.id)) {
      db.insert(tagCategories)
        .values({
          id: defCat.id,
          name: defCat.name,
          color: defCat.color,
          createdAt: now,
        })
        .run();
    }
  }

  const existingTags = db.select().from(tagDefinitions).all();
  const tagByNameLower = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]));

  for (const defTag of DEFAULT_TAGS) {
    const key = defTag.name.toLowerCase();
    if (!tagByNameLower.has(key)) {
      const id = `tag-${key.replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
      db.insert(tagDefinitions)
        .values({
          id,
          name: defTag.name,
          categoryId: defTag.categoryId,
          description: defTag.description ?? "",
          createdAt: now,
        })
        .run();
      tagByNameLower.set(key, {
        id,
        name: defTag.name,
        categoryId: defTag.categoryId,
        description: defTag.description ?? "",
        createdAt: now,
      });
    }
  }

  // Also sync any tags or mistakes already recorded on trades
  try {
    const { trades } = queryTrades({});
    for (const t of trades as any[]) {
      const tradeTags = extractTradeTokens(t.tags ?? t.tag);
      for (const rawTag of tradeTags) {
        const key = rawTag.toLowerCase();
        if (!tagByNameLower.has(key)) {
          const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          db.insert(tagDefinitions)
            .values({
              id,
              name: rawTag,
              categoryId: null,
              description: "",
              createdAt: now,
            })
            .run();
          tagByNameLower.set(key, {
            id,
            name: rawTag,
            categoryId: null,
            description: "",
            createdAt: now,
          });
        }
      }

      const tradeMistakes = extractTradeTokens(t.mistakes ?? t.mistake);
      for (const rawMistake of tradeMistakes) {
        const key = rawMistake.toLowerCase();
        if (!tagByNameLower.has(key)) {
          const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          db.insert(tagDefinitions)
            .values({
              id,
              name: rawMistake,
              categoryId: "cat-common-mistakes",
              description: "Imported from trade mistakes",
              createdAt: now,
            })
            .run();
          tagByNameLower.set(key, {
            id,
            name: rawMistake,
            categoryId: "cat-common-mistakes",
            description: "Imported from trade mistakes",
            createdAt: now,
          });
        }
      }
    }
  } catch {
    // ignore if trades query fails during early init
  }
}

export function getTagsWithUsage() {
  ensureTagsTables();

  const categories = db.select().from(tagCategories).all();
  const tags = db.select().from(tagDefinitions).all();
  const catMap = new Map(categories.map((c) => [c.id, c]));

  // Count usage across all trades (both tags and mistakes fields)
  const usageCounts = new Map<string, number>();
  try {
    const { trades } = queryTrades({});
    for (const t of trades as any[]) {
      const tokens = new Set<string>([
        ...extractTradeTokens(t.tags ?? t.tag).map((s) => s.toLowerCase()),
        ...extractTradeTokens(t.mistakes ?? t.mistake).map((s) => s.toLowerCase()),
      ]);
      for (const tok of tokens) {
        usageCounts.set(tok, (usageCounts.get(tok) ?? 0) + 1);
      }
    }
  } catch {
    // fallback
  }

  const enrichedTags = tags.map((t) => {
    const cat = t.categoryId ? catMap.get(t.categoryId) ?? null : null;
    return {
      id: t.id,
      name: t.name,
      categoryId: t.categoryId,
      categoryName: cat?.name ?? "Uncategorized",
      categoryColor: cat?.color ?? "#64748b",
      description: t.description ?? "",
      used: usageCounts.get(t.name.toLowerCase()) ?? 0,
      createdAt: t.createdAt,
    };
  });

  const enrichedCategories = categories.map((c) => ({
    ...c,
    tagCount: enrichedTags.filter((t) => t.categoryId === c.id).length,
  }));

  return {
    categories: enrichedCategories,
    tags: enrichedTags,
  };
}

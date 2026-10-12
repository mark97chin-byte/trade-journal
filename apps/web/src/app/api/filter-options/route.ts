import { handler, ok } from "@/server/api";
import { queryTrades } from "@/server/trades-query";

function extractTokens(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.flatMap((item) => extractTokens(item));
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return extractTokens(parsed);
      } catch {
        // fallback to comma split
      }
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (typeof val === "object" && val !== null) {
    if ("name" in val && typeof (val as any).name === "string") return [(val as any).name.trim()];
    if ("tag" in val && typeof (val as any).tag === "string") return [(val as any).tag.trim()];
    if ("label" in val && typeof (val as any).label === "string") return [(val as any).label.trim()];
  }
  return [];
}

export const GET = handler(async () => {
  const { trades } = queryTrades({});
  const symbols = new Set<string>();
  const tags = new Set<string>();
  const mistakes = new Set<string>();

  for (const t of trades as any[]) {
    if (t.symbol && typeof t.symbol === "string") {
      symbols.add(t.symbol.trim());
    }

    extractTokens(t.tags ?? t.tag).forEach((tag) => {
      if (tag) tags.add(tag);
    });

    extractTokens(t.mistakes ?? t.mistake).forEach((m) => {
      if (m) mistakes.add(m);
    });
  }

  return ok({
    symbols: Array.from(symbols).sort((a, b) => a.localeCompare(b)),
    tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
    mistakes: Array.from(mistakes).sort((a, b) => a.localeCompare(b)),
  });
});

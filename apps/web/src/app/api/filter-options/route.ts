import { handler, ok } from "@/server/api";
import { queryTrades } from "@/server/trades-query";
import { extractTradeTokens, getTagsWithUsage } from "@/server/tags-store";

export const GET = handler(async () => {
  const { trades } = queryTrades({});
  const { categories, tags: managedTags } = getTagsWithUsage();

  const symbols = new Set<string>();
  const tags = new Set<string>();
  const mistakes = new Set<string>();

  // Include all managed tags from Content Management
  for (const mt of managedTags) {
    tags.add(mt.name);
    if (mt.categoryName.toLowerCase().includes("mistake")) {
      mistakes.add(mt.name);
    }
  }

  // Include any live tokens on trades
  for (const t of trades as any[]) {
    if (t.symbol && typeof t.symbol === "string") {
      symbols.add(t.symbol.trim());
    }
    extractTradeTokens(t.tags ?? t.tag).forEach((tag) => {
      if (tag) tags.add(tag);
    });
    extractTradeTokens(t.mistakes ?? t.mistake).forEach((m) => {
      if (m) mistakes.add(m);
    });
  }

  return ok({
    symbols: Array.from(symbols).sort((a, b) => a.localeCompare(b)),
    tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
    mistakes: Array.from(mistakes).sort((a, b) => a.localeCompare(b)),
    categories,
    managedTags,
  });
});

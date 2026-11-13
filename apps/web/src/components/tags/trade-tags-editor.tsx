"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Plus,
  Settings2,
} from "lucide-react";
import type { CategoryItem, TagItem } from "./content-management-view";

interface TradeTagsEditorProps {
  selectedTags: string[];
  selectedMistakes: string[];
  onChange: (nextTags: string[], nextMistakes: string[]) => void;
  defaultCollapsed?: boolean;
}

export function TradeTagsEditor({
  selectedTags,
  selectedMistakes,
  onChange,
  defaultCollapsed = true,
}: TradeTagsEditorProps) {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [managedTags, setManagedTags] = useState<TagItem[]>([]);
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const [search, setSearch] = useState("");
  const [newTagCategoryId, setNewTagCategoryId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const fetchTags = async () => {
    try {
      const res = await fetch("/api/tags");
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        const cats: CategoryItem[] = data.categories ?? [];
        const tgs: TagItem[] = data.tags ?? [];
        setCategories(cats);
        setManagedTags(tgs);
        if (cats.length > 0 && !newTagCategoryId) {
          setNewTagCategoryId(cats[0]!.id);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void fetchTags();
  }, []);

  // Combine selected tags and mistakes into a unified list of active tag names
  const allSelected = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of [...selectedTags, ...selectedMistakes]) {
      const trimmed = t.trim();
      if (trimmed && !map.has(trimmed.toLowerCase())) {
        map.set(trimmed.toLowerCase(), trimmed);
      }
    }
    return Array.from(map.values());
  }, [selectedTags, selectedMistakes]);

  // Lookup map for tag metadata (color, categoryName, etc.)
  const tagMetaMap = useMemo(() => {
    const map = new Map<string, TagItem>();
    for (const t of managedTags) {
      map.set(t.name.toLowerCase(), t);
    }
    return map;
  }, [managedTags]);

  // Partition active tags into `tags` and `mistakes` when notifying parent
  const commitSelection = (nextActiveNames: string[], latestManagedTags = managedTags) => {
    const metaByLower = new Map<string, TagItem>();
    for (const t of latestManagedTags) {
      metaByLower.set(t.name.toLowerCase(), t);
    }

    const nextTags: string[] = [];
    const nextMistakes: string[] = [];

    for (const name of nextActiveNames) {
      const meta = metaByLower.get(name.toLowerCase());
      const isMistake =
        meta?.categoryName?.toLowerCase().includes("mistake") ||
        meta?.categoryId === "cat-common-mistakes" ||
        selectedMistakes.some((m) => m.toLowerCase() === name.toLowerCase() && !meta);

      if (isMistake) {
        nextMistakes.push(name);
      } else {
        nextTags.push(name);
      }
    }

    onChange(nextTags, nextMistakes);
  };

  const toggleTag = (tagName: string) => {
    const exists = allSelected.some((s) => s.toLowerCase() === tagName.toLowerCase());
    if (exists) {
      commitSelection(
        allSelected.filter((s) => s.toLowerCase() !== tagName.toLowerCase())
      );
    } else {
      commitSelection([...allSelected, tagName]);
    }
  };

  // Group tags by category (same structure as Playbook Rule Groups)
  const groupedTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<
      string,
      { categoryId: string | null; categoryName: string; color: string; items: TagItem[] }
    >();

    for (const c of categories) {
      groups.set(c.id, {
        categoryId: c.id,
        categoryName: c.name,
        color: c.color,
        items: [],
      });
    }

    const seenNames = new Set<string>();

    for (const t of managedTags) {
      seenNames.add(t.name.toLowerCase());
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !t.categoryName.toLowerCase().includes(q)
      ) {
        continue;
      }

      const key = t.categoryId ?? "uncategorized";
      const existing = groups.get(key) ?? {
        categoryId: t.categoryId,
        categoryName: t.categoryName || "Uncategorized",
        color: t.categoryColor || "#64748b",
        items: [],
      };
      existing.items.push(t);
      groups.set(key, existing);
    }

    // Include any custom tags already on this trade that aren't in managedTags
    for (const customName of allSelected) {
      if (seenNames.has(customName.toLowerCase())) continue;
      if (q && !customName.toLowerCase().includes(q)) continue;
      const key = "uncategorized";
      const existing = groups.get(key) ?? {
        categoryId: null,
        categoryName: "Custom / Uncategorized",
        color: "#64748b",
        items: [],
      };
      existing.items.push({
        id: `custom-${customName}`,
        name: customName,
        categoryId: null,
        categoryName: "Custom / Uncategorized",
        categoryColor: "#64748b",
        description: "",
        used: 1,
        createdAt: "",
      });
      groups.set(key, existing);
    }

    return Array.from(groups.values()).filter((g) => g.items.length > 0);
  }, [categories, managedTags, allSelected, search]);

  const exactMatchExists = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return managedTags.some((t) => t.name.toLowerCase() === q);
  }, [managedTags, search]);

  const handleCreateNewTag = async () => {
    const name = search.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const targetCatId = newTagCategoryId || categories[0]?.id || null;

      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_tag",
          name,
          categoryId: targetCatId,
          description: "",
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        const updatedTags: TagItem[] = data.tags ?? [];
        setCategories(data.categories ?? []);
        setManagedTags(updatedTags);
        commitSelection([...allSelected, name], updatedTags);
        setSearch("");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 space-y-2.5">
      {/* Collapsible Header Row (Matches Strategy Rules Followed Header) */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-2 text-left group"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
          )}
          <span className="font-bold text-foreground">
            Tags &amp; Categories ({allSelected.length} / {managedTags.length})
          </span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {!collapsed && allSelected.length > 0 && (
            <button
              type="button"
              onClick={() => commitSelection([])}
              className="text-[11px] underline text-muted-foreground hover:text-foreground"
            >
              Clear All
            </button>
          )}
          <Link
            href="/tags"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings2 className="h-3 w-3" />
            <span>Manage tags</span>
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded border border-border/60 bg-background/60 hover:bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {/* Compact Active Tag Pills When Collapsed */}
      {collapsed && allSelected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
          {allSelected.map((tagName) => {
            const meta = tagMetaMap.get(tagName.toLowerCase());
            const color = meta?.categoryColor ?? "#94a3b8";
            const catName = meta?.categoryName ?? "Tag";

            return (
              <span
                key={tagName}
                title={`${catName}: ${tagName}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span>{tagName}</span>
                <button
                  type="button"
                  onClick={() => toggleTag(tagName)}
                  className="ml-0.5 rounded-xs text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${tagName}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded Checklist Grouped by Category */}
      {!collapsed && (
        <div className="space-y-3.5 pt-2 border-t border-border/40">
          {/* Quick Filter / Create Tag Bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter or create new tag..."
                className="h-7 w-full rounded-md border border-border/70 bg-background pl-8 pr-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {search.trim() && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-[11px] text-muted-foreground hover:text-foreground px-1.5"
              >
                Clear
              </button>
            )}
          </div>

          {groupedTags.map((group) => (
            <div key={group.categoryId ?? "uncategorized"} className="space-y-1.5">
              {/* Category Group Title (Matches Playbook Rule Group Title) */}
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-0.5">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <span>{group.categoryName}</span>
              </div>

              {/* Checklist Rows */}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isChecked = allSelected.some(
                    (s) => s.toLowerCase() === item.name.toLowerCase()
                  );
                  return (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-xs transition select-none ${
                        isChecked
                          ? "border-border bg-secondary/70 text-foreground font-medium"
                          : "border-border/50 bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleTag(item.name)}
                        />
                        <span className="leading-snug">{item.name}</span>
                        {item.description && (
                          <span className="text-[10px] text-muted-foreground/70 truncate">
                            — {item.description}
                          </span>
                        )}
                      </div>

                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${
                          isChecked
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-secondary/60 text-muted-foreground"
                        }`}
                      >
                        {isChecked ? "Selected" : "Unchecked"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {groupedTags.length === 0 && (
            <div className="py-3 text-center text-xs text-muted-foreground">
              No matching tags found.
            </div>
          )}

          {/* Inline Quick-Create New Tag */}
          {search.trim() && !exactMatchExists && (
            <div className="border-t border-border/40 pt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Category:</span>
                <select
                  value={newTagCategoryId}
                  onChange={(e) => setNewTagCategoryId(e.target.value)}
                  className="h-7 rounded border border-border/70 bg-background px-2 text-xs text-foreground outline-none"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="">Uncategorized</option>
                </select>
              </div>

              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreateNewTag()}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary hover:bg-secondary/80 px-2.5 py-1 text-xs font-semibold text-foreground transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create &ldquo;{search.trim()}&rdquo;</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  Search,
  X,
  Tag as TagIcon,
  Plus,
  Settings2,
} from "lucide-react";
import type { CategoryItem, TagItem } from "./content-management-view";

interface TradeTagsEditorProps {
  selectedTags: string[];
  selectedMistakes: string[];
  onChange: (nextTags: string[], nextMistakes: string[]) => void;
}

export function TradeTagsEditor({
  selectedTags,
  selectedMistakes,
  onChange,
}: TradeTagsEditorProps) {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [managedTags, setManagedTags] = useState<TagItem[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [newTagCategoryId, setNewTagCategoryId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

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
    fetchTags();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Combine selected tags and mistakes into a unified set of active tag names
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

  // Group tags by category for the dropdown display
  const groupedTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<
      string,
      { categoryId: string | null; categoryName: string; color: string; items: TagItem[] }
    >();

    // Seed groups in category order
    for (const c of categories) {
      if (categoryFilter !== "all" && categoryFilter !== c.id) continue;
      groups.set(c.id, {
        categoryId: c.id,
        categoryName: c.name,
        color: c.color,
        items: [],
      });
    }

    for (const t of managedTags) {
      if (categoryFilter !== "all") {
        if (categoryFilter === "uncategorized" && t.categoryId !== null) continue;
        if (categoryFilter !== "uncategorized" && t.categoryId !== categoryFilter) continue;
      }

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

    return Array.from(groups.values()).filter((g) => g.items.length > 0);
  }, [categories, managedTags, search, categoryFilter]);

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
      const targetCatId =
        categoryFilter !== "all" && categoryFilter !== "uncategorized"
          ? categoryFilter
          : newTagCategoryId || null;

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
    <div ref={containerRef} className="space-y-2">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Tags & Categories</label>
        <Link
          href="/tags"
          className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <Settings2 className="h-3 w-3" />
          <span>Manage tags</span>
        </Link>
      </div>

      {/* Active Tag Badges */}
      {allSelected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {allSelected.map((tagName) => {
            const meta = tagMetaMap.get(tagName.toLowerCase());
            const color = meta?.categoryColor ?? "#94a3b8";
            const catName = meta?.categoryName ?? "Tag";

            return (
              <span
                key={tagName}
                title={`${catName}: ${tagName}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-[#161822] px-2 py-1 text-xs font-medium text-foreground shadow-2xs"
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

      {/* Dropdown Trigger Button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-xs text-foreground transition-colors hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <span className="text-muted-foreground">
            {allSelected.length === 0
              ? "Select tags by category..."
              : `${allSelected.length} ${allSelected.length === 1 ? "tag" : "tags"} applied — click to add or remove`}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Popover Menu */}
        {open && (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-full rounded-xl border border-border/80 bg-[#161822] p-2.5 shadow-2xl animate-in fade-in-50 zoom-in-95 space-y-2">
            {/* Search + Category Filter Row */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search or create tag..."
                  autoFocus
                  className="h-7 w-full rounded-md border border-border/70 bg-[#0f1117] pl-8 pr-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-7 max-w-[140px] rounded-md border border-border/70 bg-[#0f1117] px-2 text-[11px] text-foreground outline-none"
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="uncategorized">Uncategorized</option>
              </select>
            </div>

            {/* Categorized Tag Checkboxes */}
            <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1">
              {groupedTags.map((group) => (
                <div key={group.categoryId ?? "uncategorized"} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <TagIcon
                      className="h-2.5 w-2.5 shrink-0"
                      style={{ color: group.color, fill: group.color }}
                    />
                    <span>{group.categoryName}</span>
                  </div>

                  <div className="grid grid-cols-1 gap-0.5 pl-1">
                    {group.items.map((item) => {
                      const isChecked = allSelected.some(
                        (s) => s.toLowerCase() === item.name.toLowerCase()
                      );
                      return (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1 text-xs text-foreground hover:bg-secondary/50 transition-colors select-none"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleTag(item.name)}
                            />
                            <span className="truncate">{item.name}</span>
                          </div>
                          {item.used > 0 && (
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {item.used}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              {groupedTags.length === 0 && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No matching tags found.
                </div>
              )}
            </div>

            {/* Inline Quick-Create New Tag */}
            {search.trim() && !exactMatchExists && (
              <div className="border-t border-border/40 pt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">In:</span>
                  <select
                    value={
                      categoryFilter !== "all" && categoryFilter !== "uncategorized"
                        ? categoryFilter
                        : newTagCategoryId
                    }
                    onChange={(e) => setNewTagCategoryId(e.target.value)}
                    className="h-7 rounded border border-border/70 bg-[#0f1117] px-2 text-xs text-foreground outline-none"
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
                  onClick={handleCreateNewTag}
                  className="inline-flex items-center gap-1 rounded-md bg-[#4f46e5] hover:bg-[#4338ca] px-2.5 py-1 text-xs font-semibold text-white transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create &ldquo;{search.trim()}&rdquo;</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

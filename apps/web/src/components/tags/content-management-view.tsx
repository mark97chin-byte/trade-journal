"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Search,
  MoreVertical,
  Tag as TagIcon,
  Plus,
  Trash2,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
  tagCount: number;
  createdAt: string;
}

export interface TagItem {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  description: string;
  used: number;
  createdAt: string;
}

const COLOR_PALETTE = [
  "#94a3b8", // Slate / Periwinkle
  "#dc2626", // Red (Caution)
  "#10b981", // Emerald Green (Valid Framework)
  "#f43f5e", // Rose (Mistakes)
  "#6366f1", // Indigo
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#06b6d4", // Cyan
  "#ec4899", // Pink
];

export function ContentManagementView() {
  const [activeTab, setActiveTab] = useState<"categories" | "tags">("categories");
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter states
  const [catSearch, setCatSearch] = useState("");
  const [catSort, setCatSort] = useState<"name-asc" | "name-desc" | "most-tags">("name-asc");
  const [tagSearch, setTagSearch] = useState("");
  const [tagCategoryFilter, setTagCategoryFilter] = useState<string>("all");

  // Selection states
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Row action menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Modal state for Category
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryItem | null>(null);
  const [catNameInput, setCatNameInput] = useState("");
  const [catColorInput, setCatColorInput] = useState(COLOR_PALETTE[0]!);

  // Modal state for Tag
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagItem | null>(null);
  const [tagNameInput, setTagNameInput] = useState("");
  const [tagCatInput, setTagCatInput] = useState<string>("");
  const [tagDescInput, setTagDescInput] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tags");
      if (res.ok) {
        const json = await res.json();
        const payload = json.data || json;
        setCategories(payload.categories ?? []);
        setTags(payload.tags ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const postAction = async (payload: Record<string, any>) => {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      const data = json.data || json;
      setCategories(data.categories ?? []);
      setTags(data.tags ?? []);
    }
  };

  // Filtered & sorted categories
  const filteredCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    const list = categories.filter((c) => !q || c.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      if (catSort === "name-asc") return a.name.localeCompare(b.name);
      if (catSort === "name-desc") return b.name.localeCompare(a.name);
      return b.tagCount - a.tagCount;
    });
  }, [categories, catSearch, catSort]);

  // Filtered tags
  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return tags.filter((t) => {
      if (tagCategoryFilter !== "all") {
        if (tagCategoryFilter === "uncategorized" && t.categoryId !== null) return false;
        if (tagCategoryFilter !== "uncategorized" && t.categoryId !== tagCategoryFilter) return false;
      }
      if (q && !t.name.toLowerCase().includes(q) && !t.categoryName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [tags, tagSearch, tagCategoryFilter]);

  // Category modal handlers
  const openAddCategory = () => {
    setEditingCat(null);
    setCatNameInput("");
    setCatColorInput(COLOR_PALETTE[0]!);
    setCatModalOpen(true);
  };

  const openEditCategory = (cat: CategoryItem) => {
    setEditingCat(cat);
    setCatNameInput(cat.name);
    setCatColorInput(cat.color);
    setCatModalOpen(true);
    setOpenMenuId(null);
  };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNameInput.trim()) return;
    if (editingCat) {
      await postAction({
        action: "update_category",
        id: editingCat.id,
        name: catNameInput,
        color: catColorInput,
      });
    } else {
      await postAction({
        action: "create_category",
        name: catNameInput,
        color: catColorInput,
      });
    }
    setCatModalOpen(false);
  };

  // Tag modal handlers
  const openAddTag = () => {
    setEditingTag(null);
    setTagNameInput("");
    setTagCatInput(categories[0]?.id ?? "");
    setTagDescInput("");
    setTagModalOpen(true);
  };

  const openEditTag = (t: TagItem) => {
    setEditingTag(t);
    setTagNameInput(t.name);
    setTagCatInput(t.categoryId ?? "");
    setTagDescInput(t.description ?? "");
    setTagModalOpen(true);
    setOpenMenuId(null);
  };

  const saveTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagNameInput.trim()) return;
    if (editingTag) {
      await postAction({
        action: "update_tag",
        id: editingTag.id,
        name: tagNameInput,
        categoryId: tagCatInput || null,
        description: tagDescInput,
      });
    } else {
      await postAction({
        action: "create_tag",
        name: tagNameInput,
        categoryId: tagCatInput || null,
        description: tagDescInput,
      });
    }
    setTagModalOpen(false);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Content management</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organize your content by creating categories and tags.
          </p>
        </div>
      </div>

      {/* Sub-Tabs: Categories | Tags */}
      <div className="flex items-center gap-6 border-b border-border/40">
        <button
          type="button"
          onClick={() => setActiveTab("categories")}
          className={`relative pb-2.5 text-xs font-semibold transition-colors ${
            activeTab === "categories"
              ? "text-muted-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Categories
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("tags")}
          className={`relative pb-2.5 text-xs font-semibold transition-colors ${
            activeTab === "tags"
              ? "text-muted-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Tags
        </button>
      </div>

      {/* TAB 1: CATEGORIES */}
      {activeTab === "categories" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={catSearch}
                onChange={(e) => setCatSearch(e.target.value)}
                placeholder="Search categories"
                className="h-8 w-full rounded-md border border-border/60 bg-[#12141a] pl-8 pr-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2.5">
              {selectedCats.size > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await postAction({
                      action: "delete_categories",
                      ids: Array.from(selectedCats),
                    });
                    setSelectedCats(new Set());
                  }}
                  className="h-8 text-xs gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete ({selectedCats.size})
                </Button>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Sort by</span>
                <select
                  value={catSort}
                  onChange={(e) => setCatSort(e.target.value as any)}
                  className="h-8 rounded-md border border-border/60 bg-[#12141a] px-2.5 text-xs text-foreground outline-none"
                >
                  <option value="name-asc">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                  <option value="most-tags">Most tags</option>
                </select>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={openAddCategory}
                className="h-8 bg-secondary text-foreground font-semibold border border-border hover:bg-secondary text-foreground font-semibold border border-border text-xs font-semibold px-3.5"
              >
                Add category
              </Button>
            </div>
          </div>

          {/* Categories Table */}
          <div className="rounded-xl border border-border/40 bg-[#12141a] overflow-visible">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/40 bg-[#161822]/60 text-muted-foreground">
                <tr>
                  <th className="w-10 py-3 pl-4">
                    <Checkbox
                      checked={
                        filteredCategories.length > 0 &&
                        filteredCategories.every((c) => selectedCats.has(c.id))
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedCats(new Set(filteredCategories.map((c) => c.id)));
                        } else {
                          setSelectedCats(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="py-3 font-medium">Name</th>
                  <th className="py-3 font-medium">Color</th>
                  <th className="py-3 font-medium">Tags</th>
                  <th className="w-12 py-3 pr-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filteredCategories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="py-3 pl-4">
                      <Checkbox
                        checked={selectedCats.has(cat.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedCats);
                          if (checked) next.add(cat.id);
                          else next.delete(cat.id);
                          setSelectedCats(next);
                        }}
                      />
                    </td>
                    <td className="py-3 font-medium text-foreground">{cat.name}</td>
                    <td className="py-3">
                      <span
                        className="inline-block h-4 w-4 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                    </td>
                    <td className="py-3 text-muted-foreground tabular-nums">{cat.tagCount}</td>
                    <td className="relative py-3 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(openMenuId === cat.id ? null : cat.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {openMenuId === cat.id && (
                        <div className="absolute right-4 top-10 z-50 w-32 rounded-lg border border-border/80 bg-[#161822] p-1 shadow-xl text-left">
                          <button
                            type="button"
                            onClick={() => openEditCategory(cat)}
                            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setOpenMenuId(null);
                              await postAction({ action: "delete_categories", id: cat.id });
                            }}
                            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}

                {!loading && filteredCategories.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No categories found. Click &ldquo;Add category&rdquo; to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: TAGS */}
      {activeTab === "tags" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="Search tags"
                className="h-8 w-full rounded-md border border-border/60 bg-[#12141a] pl-8 pr-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {selectedTags.size > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await postAction({
                      action: "delete_tags",
                      ids: Array.from(selectedTags),
                    });
                    setSelectedTags(new Set());
                  }}
                  className="h-8 text-xs gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete ({selectedTags.size})
                </Button>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Filter by</span>
                <select
                  value={tagCategoryFilter}
                  onChange={(e) => setTagCategoryFilter(e.target.value)}
                  className="h-8 rounded-md border border-border/60 bg-[#12141a] px-2.5 text-xs text-foreground outline-none"
                >
                  <option value="all">All</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="uncategorized">Uncategorized</option>
                </select>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => postAction({ action: "reset_tags" })}
                className="h-8 text-xs gap-1.5"
              >
                <RotateCcw className="h-3 w-3" />
                Reset tags
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={openAddTag}
                className="h-8 bg-secondary text-foreground font-semibold border border-border hover:bg-secondary text-foreground font-semibold border border-border text-xs font-semibold px-3.5"
              >
                Add tag
              </Button>
            </div>
          </div>

          {/* Tags Table */}
          <div className="rounded-xl border border-border/40 bg-[#12141a] overflow-visible">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/40 bg-[#161822]/60 text-muted-foreground">
                <tr>
                  <th className="w-10 py-3 pl-4">
                    <Checkbox
                      checked={
                        filteredTags.length > 0 &&
                        filteredTags.every((t) => selectedTags.has(t.id))
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedTags(new Set(filteredTags.map((t) => t.id)));
                        } else {
                          setSelectedTags(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="py-3 font-medium">Name</th>
                  <th className="py-3 font-medium">Category</th>
                  <th className="py-3 font-medium">Used</th>
                  <th className="py-3 font-medium">Description</th>
                  <th className="w-12 py-3 pr-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filteredTags.map((t) => (
                  <tr key={t.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="py-3 pl-4">
                      <Checkbox
                        checked={selectedTags.has(t.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedTags);
                          if (checked) next.add(t.id);
                          else next.delete(t.id);
                          setSelectedTags(next);
                        }}
                      />
                    </td>
                    <td className="py-3 font-medium text-foreground">{t.name}</td>
                    <td className="py-3">
                      <div className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <TagIcon
                          className="h-3.5 w-3.5"
                          style={{ color: t.categoryColor, fill: t.categoryColor }}
                        />
                        <span className="text-foreground/90">{t.categoryName}</span>
                      </div>
                    </td>
                    <td className="py-3 tabular-nums text-muted-foreground">{t.used}</td>
                    <td className="py-3 text-muted-foreground max-w-xs truncate">
                      {t.description}
                    </td>
                    <td className="relative py-3 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(openMenuId === t.id ? null : t.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {openMenuId === t.id && (
                        <div className="absolute right-4 top-10 z-50 w-32 rounded-lg border border-border/80 bg-[#161822] p-1 shadow-xl text-left">
                          <button
                            type="button"
                            onClick={() => openEditTag(t)}
                            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setOpenMenuId(null);
                              await postAction({ action: "delete_tags", id: t.id });
                            }}
                            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}

                {!loading && filteredTags.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No tags match your filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADD / EDIT CATEGORY MODAL */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <form
            onSubmit={saveCategory}
            className="w-full max-w-md rounded-xl border border-border/70 bg-[#161822] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-sm font-semibold text-foreground">
                {editingCat ? "Edit category" : "Add category"}
              </h3>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-muted-foreground mb-1">Category name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={catNameInput}
                  onChange={(e) => setCatNameInput(e.target.value)}
                  placeholder="e.g., Common mistakes, Session profile..."
                  className="h-9 w-full rounded-md border border-border/60 bg-[#0f1117] px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1.5">Color</label>
                <div className="flex flex-wrap items-center gap-2.5">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCatColorInput(color)}
                      className={`h-6 w-6 rounded-full border-2 transition-transform ${
                        catColorInput === color
                          ? "border-white scale-110"
                          : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCatModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-secondary text-foreground font-semibold border border-border hover:bg-secondary text-foreground font-semibold border border-border text-xs font-semibold"
              >
                {editingCat ? "Save changes" : "Create category"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ADD / EDIT TAG MODAL */}
      {tagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <form
            onSubmit={saveTag}
            className="w-full max-w-md rounded-xl border border-border/70 bg-[#161822] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-sm font-semibold text-foreground">
                {editingTag ? "Edit tag" : "Add tag"}
              </h3>
              <button
                type="button"
                onClick={() => setTagModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-muted-foreground mb-1">Tag name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={tagNameInput}
                  onChange={(e) => setTagNameInput(e.target.value)}
                  placeholder="e.g., ny reversal, continuation purge, FOMO..."
                  className="h-9 w-full rounded-md border border-border/60 bg-[#0f1117] px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">Category</label>
                <select
                  value={tagCatInput}
                  onChange={(e) => setTagCatInput(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-[#0f1117] px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">Description (optional)</label>
                <textarea
                  rows={2}
                  value={tagDescInput}
                  onChange={(e) => setTagDescInput(e.target.value)}
                  placeholder="Notes on when to apply this tag..."
                  className="w-full rounded-md border border-border/60 bg-[#0f1117] p-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTagModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-secondary text-foreground font-semibold border border-border hover:bg-secondary text-foreground font-semibold border border-border text-xs font-semibold"
              >
                {editingTag ? "Save changes" : "Create tag"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

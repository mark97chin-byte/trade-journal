"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Search, X, Tag as TagIcon } from "lucide-react";

export interface CategorizedOption {
  name: string;
  categoryName?: string;
  categoryColor?: string;
}

interface MultiSelectDropdownProps {
  options: string[];
  categorizedOptions?: CategorizedOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
}

export function MultiSelectDropdown({
  options,
  categorizedOptions,
  selected,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, search]);

  const groupedCategorized = useMemo(() => {
    if (!categorizedOptions || categorizedOptions.length === 0) return null;
    const q = search.trim().toLowerCase();
    const groups = new Map<string, { color: string; items: string[] }>();

    for (const item of categorizedOptions) {
      if (
        q &&
        !item.name.toLowerCase().includes(q) &&
        !(item.categoryName ?? "").toLowerCase().includes(q)
      ) {
        continue;
      }
      const catName = item.categoryName || "Uncategorized";
      const curr = groups.get(catName) ?? {
        color: item.categoryColor || "#64748b",
        items: [],
      };
      if (!curr.items.includes(item.name)) {
        curr.items.push(item.name);
      }
      groups.set(catName, curr);
    }

    return Array.from(groups.entries());
  }, [categorizedOptions, search]);

  const toggleOption = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((item) => item !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const addCustom = (val: string) => {
    if (!val || selected.includes(val)) return;
    onChange([...selected, val]);
    setSearch("");
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden text-left">
          {selected.length === 0 ? (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          ) : selected.length <= 2 ? (
            <span className="truncate font-medium">{selected.join(", ")}</span>
          ) : (
            <span className="flex items-center gap-1.5 truncate">
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                {selected.length}
              </span>
              <span className="truncate text-foreground font-medium">selected</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 pl-1">
          {selected.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClear(e as any);
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Clear selection"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[240px] rounded-md border border-border bg-[#161822] p-2 shadow-xl animate-in fade-in-50 zoom-in-95">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
              className="h-7 w-full rounded border border-border/70 bg-background pl-7 pr-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {options.length > 0 && (
            <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
              <span>{selected.length} selected</span>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="hover:text-foreground hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          )}

          <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
            {groupedCategorized ? (
              groupedCategorized.length === 0 ? (
                <div className="py-2.5 text-center text-xs text-muted-foreground">
                  No matches found
                </div>
              ) : (
                groupedCategorized.map(([catName, group]) => (
                  <div key={catName} className="space-y-0.5 pb-1">
                    <div className="flex items-center gap-1.5 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <TagIcon
                        className="h-2.5 w-2.5"
                        style={{ color: group.color, fill: group.color }}
                      />
                      <span>{catName}</span>
                    </div>
                    {group.items.map((opt) => {
                      const isChecked = selected.includes(opt);
                      return (
                        <label
                          key={opt}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-foreground hover:bg-secondary/60 transition-colors select-none"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleOption(opt)}
                          />
                          <span className="truncate">{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                ))
              )
            ) : filteredOptions.length === 0 ? (
              <div className="py-2.5 text-center text-xs text-muted-foreground">
                {options.length === 0 ? "No records in database" : "No matches found"}
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isChecked = selected.includes(opt);
                return (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground hover:bg-secondary/60 transition-colors select-none"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleOption(opt)}
                    />
                    <span className="truncate">{opt}</span>
                  </label>
                );
              })
            )}

            {search.trim() && !options.includes(search.trim()) && (
              <button
                type="button"
                onClick={() => addCustom(search.trim())}
                className="mt-1 flex w-full items-center gap-1.5 rounded border border-dashed border-border/70 px-2 py-1.5 text-xs text-primary hover:bg-secondary/40 transition-colors text-left"
              >
                <span>+ Add &ldquo;{search.trim()}&rdquo;</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

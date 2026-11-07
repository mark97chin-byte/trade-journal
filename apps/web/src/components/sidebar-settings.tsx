"use client";

import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  NotebookPen,
  ListOrdered,
  BarChart3,
  Landmark,
  BookText,
  BookOpen,
  Tags,
  ListChecks,
  BookmarkPlus,
  Import,
  Wallet,
  Settings,
  Eye,
  EyeOff,
  RotateCcw,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const SIDEBAR_HIDDEN_STORAGE_KEY = "journal-sidebar-hidden-items-v1";
export const SIDEBAR_ORDER_STORAGE_KEY = "journal-sidebar-order-v1";
export const DEFAULT_HIDDEN_SIDEBAR_HREFS = ["/prop-firms", "/tags"];

export const ALL_SIDEBAR_ITEMS = [
  { href: "/", label: "Dashboard", group: "main", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", group: "main", icon: CalendarDays },
  { href: "/journal", label: "Journal", group: "main", icon: NotebookPen },
  { href: "/trades", label: "Trades", group: "main", icon: ListOrdered },
  { href: "/reports", label: "Reports", group: "main", icon: BarChart3 },
  { href: "/prop-firms", label: "Prop firms", group: "main", icon: Landmark },
  { href: "/notebook", label: "Notebook", group: "main", icon: BookText },
  { href: "/playbooks", label: "Playbooks", group: "main", icon: BookOpen },
  { href: "/tags", label: "Tags", group: "main", icon: Tags },
  { href: "/progress", label: "Progress", group: "main", icon: ListChecks },
  { href: "/missed", label: "Missed trades", group: "main", icon: BookmarkPlus },
  { href: "/import", label: "Import", group: "setup", icon: Import },
  { href: "/accounts", label: "Accounts", group: "setup", icon: Wallet },
  { href: "/settings", label: "Settings", group: "setup", icon: Settings, locked: true },
] as const;

export const DEFAULT_SIDEBAR_ORDER = ALL_SIDEBAR_ITEMS.map((i) => i.href);

export function readHiddenSidebarHrefs(): string[] {
  if (typeof window === "undefined") return DEFAULT_HIDDEN_SIDEBAR_HREFS;
  try {
    const raw = localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY);
    if (!raw) return DEFAULT_HIDDEN_SIDEBAR_HREFS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => typeof x === "string" && x !== "/settings");
    }
  } catch {}
  return DEFAULT_HIDDEN_SIDEBAR_HREFS;
}

export function writeHiddenSidebarHrefs(hiddenHrefs: string[]) {
  const clean = hiddenHrefs.filter((x) => x !== "/settings");
  try {
    localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent("journal-sidebar-visibility-change"));
  } catch {}
}

export function readSidebarOrder(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_SIDEBAR_ORDER];
  try {
    const raw = localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_ORDER];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((x) => typeof x === "string");
      const missing = DEFAULT_SIDEBAR_ORDER.filter((h) => !valid.includes(h));
      return [...valid, ...missing];
    }
  } catch {}
  return [...DEFAULT_SIDEBAR_ORDER];
}

export function writeSidebarOrder(orderHrefs: string[]) {
  try {
    localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(orderHrefs));
    window.dispatchEvent(new CustomEvent("journal-sidebar-visibility-change"));
  } catch {}
}

export function SidebarSettings() {
  const [hiddenHrefs, setHiddenHrefs] = useState<string[]>(DEFAULT_HIDDEN_SIDEBAR_HREFS);
  const [orderHrefs, setOrderHrefs] = useState<string[]>([...DEFAULT_SIDEBAR_ORDER]);

  useEffect(() => {
    setHiddenHrefs(readHiddenSidebarHrefs());
    setOrderHrefs(readSidebarOrder());
  }, []);

  const toggleHref = (href: string) => {
    if (href === "/settings") return;
    const next = hiddenHrefs.includes(href)
      ? hiddenHrefs.filter((x) => x !== href)
      : [...hiddenHrefs, href];
    setHiddenHrefs(next);
    writeHiddenSidebarHrefs(next);
  };

  const moveItem = (href: string, group: "main" | "setup", direction: -1 | 1) => {
    const groupHrefs = orderHrefs.filter((h) => {
      const meta = ALL_SIDEBAR_ITEMS.find((x) => x.href === h);
      return meta?.group === group;
    });
    const idx = groupHrefs.indexOf(href);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= groupHrefs.length) return;

    const swappedGroup = [...groupHrefs];
    const temp = swappedGroup[idx]!;
    swappedGroup[idx] = swappedGroup[targetIdx]!;
    swappedGroup[targetIdx] = temp;

    const otherGroup = orderHrefs.filter((h) => {
      const meta = ALL_SIDEBAR_ITEMS.find((x) => x.href === h);
      return meta?.group !== group;
    });

    const nextOrder = group === "main" ? [...swappedGroup, ...otherGroup] : [...otherGroup, ...swappedGroup];
    setOrderHrefs(nextOrder);
    writeSidebarOrder(nextOrder);
  };

  const renderGroup = (groupKey: "main" | "setup", title: string) => {
    const items = orderHrefs
      .map((h) => ALL_SIDEBAR_ITEMS.find((x) => x.href === h))
      .filter((x): x is (typeof ALL_SIDEBAR_ITEMS)[number] => Boolean(x && x.group === groupKey));

    return (
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        <div className="space-y-1.5">
          {items.map((item, idx) => {
            const Icon = item.icon;
            const isLocked = "locked" in item && item.locked;
            const isVisible = isLocked || !hiddenHrefs.includes(item.href);

            return (
              <div
                key={item.href}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs transition ${
                  isVisible
                    ? "border-indigo-500/35 bg-indigo-500/10"
                    : "border-border/60 bg-background/60 text-muted-foreground opacity-75"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-5 font-mono text-[10px] text-muted-foreground">
                    #{idx + 1}
                  </span>
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isVisible ? "text-indigo-400" : "text-muted-foreground"
                    }`}
                  />
                  <div>
                    <div
                      className={`font-semibold ${
                        isVisible ? "text-foreground" : "text-muted-foreground line-through"
                      }`}
                    >
                      {item.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">{item.href}</div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Reorder Up / Down Buttons */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={idx === 0}
                    onClick={() => moveItem(item.href, groupKey, -1)}
                    className="h-7 w-7 p-0"
                    title="Move up in sidebar"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={idx === items.length - 1}
                    onClick={() => moveItem(item.href, groupKey, 1)}
                    className="h-7 w-7 p-0"
                    title="Move down in sidebar"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>

                  {/* Show / Hide Toggle Button */}
                  {isLocked ? (
                    <span className="ml-1 rounded bg-secondary px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                      Always Shown
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleHref(item.href)}
                      className={`ml-1 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        isVisible
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                          : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isVisible ? (
                        <>
                          <Eye className="h-3 w-3" />
                          <span>Shown</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="h-3 w-3" />
                          <span>Hidden</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base font-bold">
            Left Sidebar Navigation &amp; Tab Order
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Rearrange tabs with the Up/Down arrows and toggle which items are shown in the left
            sidebar. Hidden pages remain active if visited directly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setHiddenHrefs(DEFAULT_HIDDEN_SIDEBAR_HREFS);
              writeHiddenSidebarHrefs(DEFAULT_HIDDEN_SIDEBAR_HREFS);
              setOrderHrefs([...DEFAULT_SIDEBAR_ORDER]);
              writeSidebarOrder([...DEFAULT_SIDEBAR_ORDER]);
            }}
            className="h-8 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset Order &amp; Defaults
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setHiddenHrefs([]);
              writeHiddenSidebarHrefs([]);
            }}
            className="h-8 text-xs"
          >
            Show All Tabs
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {renderGroup("main", "Main Navigation Tabs")}
        {renderGroup("setup", "Setup & Data Tabs")}
      </CardContent>
    </Card>
  );
}

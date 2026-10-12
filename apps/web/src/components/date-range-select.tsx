"use client";

import React, { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar as CalendarIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const PRESETS = [
  { key: "this-week", label: "Current week" },
  { key: "last-week", label: "Last week" },
  { key: "this-month", label: "Current month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "Current quarter" },
  { key: "last-quarter", label: "Last quarter" },
  { key: "this-year", label: "Current year" },
  { key: "last-year", label: "Last year" },
  { key: "all", label: "All time" },
];

export function DateRangeSelect({ currentRange }: { currentRange: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState(searchParams.get("from") ?? "");
  const [toDate, setToDate] = useState(searchParams.get("to") ?? "");

  const activeLabel =
    PRESETS.find((p) => p.key === currentRange)?.label ??
    (currentRange === "custom" && fromDate
      ? `${fromDate} → ${toDate || "now"}`
      : currentRange.toUpperCase());

  const selectPreset = (key: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("range", key);
    next.delete("from");
    next.delete("to");
    router.replace(`${pathname}?${next.toString()}`);
    setOpen(false);
  };

  const applyCustom = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("range", "custom");
    if (fromDate) next.set("from", fromDate);
    else next.delete("from");
    if (toDate) next.set("to", toDate);
    else next.delete("to");
    router.replace(`${pathname}?${next.toString()}`);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-1.5 px-2.5 text-xs font-medium"
      >
        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{activeLabel}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Select Date Range</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Presets Grid */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => selectPreset(p.key)}
                  className={`rounded-md border p-2 text-left text-xs font-medium transition-colors ${
                    currentRange === p.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-secondary/20 hover:bg-secondary/60 text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom Range Picker */}
            <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-2.5">
              <span className="text-xs font-semibold text-muted-foreground">Custom Range</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">From</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">To</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <Button size="sm" onClick={applyCustom} className="w-full mt-1 text-xs">
                Apply Custom Range
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

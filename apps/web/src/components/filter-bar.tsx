"use client";
import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dayKeyOf, FILTER_KEYS, readFilters, type AnalysisFilters } from "@luxalgo/journal-core";
import { useApi } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterFields } from "./filter-fields";
import { SlidersHorizontal } from "lucide-react";
import { AccountSelector } from "./account-selector";
import { DateRangeSelect } from "./date-range-select";

export const useFilters = () => {
  const params = useSearchParams();
  const { data } = useApi<{ timeZone: string }>("/api/settings");
  const range = params.get("range") ?? "all";
  const timeZone = data?.timeZone ?? "UTC";

  return useMemo(() => {
    const f = readFilters(new URLSearchParams(params.toString()));
    const today = dayKeyOf(new Date().toISOString(), timeZone);
    const [yStr, mStr, dStr] = today.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    const day = Number(dStr);
    const todayDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dayOfWeek = todayDate.getUTCDay();

    switch (range) {
      case "this-week": {
        const diffToMon = (dayOfWeek + 6) % 7;
        const mon = new Date(todayDate);
        mon.setUTCDate(mon.getUTCDate() - diffToMon);
        f.from = mon.toISOString().slice(0, 10);
        f.to = today;
        break;
      }
      case "last-week": {
        const diffToMon = (dayOfWeek + 6) % 7;
        const mon = new Date(todayDate);
        mon.setUTCDate(mon.getUTCDate() - diffToMon - 7);
        const sun = new Date(mon);
        sun.setUTCDate(mon.getUTCDate() + 6);
        f.from = mon.toISOString().slice(0, 10);
        f.to = sun.toISOString().slice(0, 10);
        break;
      }
      case "this-month": {
        f.from = `${yStr}-${mStr}-01`;
        f.to = today;
        break;
      }
      case "last-month": {
        const pYear = month === 1 ? year - 1 : year;
        const pMonth = month === 1 ? 12 : month - 1;
        const pMonthStr = String(pMonth).padStart(2, "0");
        const lastDay = new Date(Date.UTC(pYear, pMonth, 0)).getUTCDate();
        f.from = `${pYear}-${pMonthStr}-01`;
        f.to = `${pYear}-${pMonthStr}-${String(lastDay).padStart(2, "0")}`;
        break;
      }
      case "this-quarter": {
        const q = Math.floor((month - 1) / 3);
        const startM = String(q * 3 + 1).padStart(2, "0");
        f.from = `${yStr}-${startM}-01`;
        f.to = today;
        break;
      }
      case "last-quarter": {
        const currQ = Math.floor((month - 1) / 3);
        const pQ = currQ === 0 ? 3 : currQ - 1;
        const pY = currQ === 0 ? year - 1 : year;
        const startM = String(pQ * 3 + 1).padStart(2, "0");
        const endM = pQ * 3 + 3;
        const lastDay = new Date(Date.UTC(pY, endM, 0)).getUTCDate();
        f.from = `${pY}-${startM}-01`;
        f.to = `${pY}-${String(endM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        break;
      }
      case "this-year":
      case "ytd": {
        f.from = `${yStr}-01-01`;
        f.to = today;
        break;
      }
      case "last-year": {
        f.from = `${year - 1}-01-01`;
        f.to = `${year - 1}-12-31`;
        break;
      }
      case "7d":
      case "30d":
      case "90d": {
        const d = new Date(today + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() - Number(range.slice(0, -1)) + 1);
        f.from = d.toISOString().slice(0, 10);
        f.to = today;
        break;
      }
      case "all":
      default: {
        // retain custom or empty bounds
        break;
      }
    }

    return {
      accounts: f.accounts ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      range,
      timeZone,
      values: f,
      query: new URLSearchParams(Object.entries(f).filter(([, v]) => Boolean(v))).toString(),
    };
  }, [params, range, timeZone]);
};

export type Filters = ReturnType<typeof useFilters>;

export function FilterBar({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useFilters();
  const showFilters =
    ["/", "/reports", "/trades", "/calendar", "/journal", "/playbooks"].includes(pathname) ||
    pathname.startsWith("/journal/");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AnalysisFilters>({});
  const filterTitle = useRef<HTMLHeadingElement>(null);
  const count = Object.keys(filters.values).filter((k) => !["from", "to"].includes(k)).length;

  return (
    <>
      <div className="journal-filter-bar sticky z-10 flex min-h-14 min-w-0 flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <h1 className="mr-auto min-w-0 text-base font-semibold tracking-tight">{title}</h1>
        {showFilters && (
          <>
            <AccountSelector />
            <DateRangeSelect currentRange={filters.range} />
            <Button
              variant="outline"
              size="sm"
              title="Filter by dates, symbols, strategy, outcome, and more."
              onClick={() => {
                setDraft(filters.values);
                setOpen(true);
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters{count > 0 ? ` · ${count}` : ""}
            </Button>
          </>
        )}
        {actions && (
          <div className="journal-header-actions flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="journal-filter-dialog sm:max-w-3xl">
          <DialogHeader className="journal-filter-heading">
            <DialogTitle ref={filterTitle} tabIndex={-1} className="outline-none">
              Filter your journal
            </DialogTitle>
            <DialogDescription className="journal-filter-description">
              Times use {filters.timeZone}. Dates use the closing day, or opening day for open trades.
            </DialogDescription>
          </DialogHeader>
          <div className="journal-filter-body">
            <FilterFields value={draft} onChange={setDraft} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import {
  FileText,
  ArrowRight,
  CheckCircle2,
  Archive,
  Clock,
  AlertCircle,
  Loader2,
  Send,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDateDMY } from "@/lib/timezone";

interface DraftNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  sameDay?: boolean;
  symbolMatch?: boolean;
}

interface TradeCandidate {
  key: string;
  symbol: string;
  direction: string;
  status: string;
  openedAt: string;
  netPnl: number;
  hasNotes?: number;
}

export function NotebookTradeMatcherModal({
  open,
  onOpenChange,
  preselectedNoteId,
  preselectedTradeKey,
  defaultMode = "trade",
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedNoteId?: string;
  preselectedTradeKey?: string;
  defaultMode?: "trade" | "missed";
  onCompleted?: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"trade" | "missed">(defaultMode);
  const [notes, setNotes] = useState<DraftNote[]>([]);
  const [trades, setTrades] = useState<TradeCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Multi-entry mapping state: noteId -> { selected, tradeKey, targetSection }
  const [mappings, setMappings] = useState<
    Record<
      string,
      {
        selected: boolean;
        tradeKey: string;
        targetSection: "setup" | "review";
      }
    >
  >({});

  // Missed trade form state
  const [missedNoteId, setMissedNoteId] = useState<string>("");
  const [missedSymbol, setMissedSymbol] = useState<string>("NAS100");
  const [missedDirection, setMissedDirection] = useState<"long" | "short">("long");
  const [missedReason, setMissedReason] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode);
    setError(null);
    setLoading(true);

    const qs = preselectedTradeKey ? `?tradeKey=${encodeURIComponent(preselectedTradeKey)}` : "";
    fetch(`/api/notebook-bridge${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load drafts");
        const allNotes: DraftNote[] = data.notes || [];
        const allTrades: TradeCandidate[] = data.recentTrades || [];
        const matchingDrafts: DraftNote[] = data.matchingDrafts || [];

        setNotes(allNotes);
        setTrades(allTrades);

        const defaultTradeKey = preselectedTradeKey || allTrades[0]?.key || "";
        const initMap: Record<
          string,
          { selected: boolean; tradeKey: string; targetSection: "setup" | "review" }
        > = {};

        allNotes.forEach((n, idx) => {
          const isPreselected = preselectedNoteId
            ? n.id === preselectedNoteId
            : matchingDrafts.some((m) => m.id === n.id) && idx === 0;

          // Smartly pair multiple drafts on the same day to trades on that same day
          const noteDate = (n.updatedAt || "").slice(0, 10);
          const sameDayTrades = allTrades.filter((t) => (t.openedAt || "").slice(0, 10) === noteDate);
          const guessedTradeKey = preselectedTradeKey
            ? preselectedTradeKey
            : sameDayTrades[idx]?.key || sameDayTrades[0]?.key || defaultTradeKey;

          initMap[n.id] = {
            selected: Boolean(isPreselected),
            tradeKey: guessedTradeKey,
            targetSection: "setup",
          };
        });

        setMappings(initMap);
        setMissedNoteId(preselectedNoteId || allNotes[0]?.id || "");
      })
      .catch((err: any) => setError(err?.message || "Could not load Notebook drafts"))
      .finally(() => setLoading(false));
  }, [open, preselectedNoteId, preselectedTradeKey, defaultMode]);

  const selectedCount = Object.values(mappings).filter((m) => m.selected && m.tradeKey).length;

  const handleConfirmTransferToTrades = async () => {
    const transfers = Object.entries(mappings)
      .filter(([, cfg]) => cfg.selected && cfg.tradeKey)
      .map(([noteId, cfg]) => ({
        noteId,
        tradeKey: cfg.tradeKey,
        targetSection: cfg.targetSection,
        mode: "append" as const,
      }));

    if (transfers.length === 0) {
      setError("Select at least one Notebook draft and target trade.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/notebook-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer_to_trades",
          transfers,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Transfer failed");
      onOpenChange(false);
      onCompleted?.(data.message || "Moved Notebook draft(s) to Trade Journal and archived.");
    } catch (err: any) {
      setError(err?.message || "Failed to transfer drafts");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmTransferToMissed = async () => {
    if (!missedNoteId) {
      setError("Choose a Notebook draft to move to Missed Trades.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/notebook-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer_to_missed",
          noteId: missedNoteId,
          symbol: missedSymbol,
          direction: missedDirection,
          setup: missedReason,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create missed trade");
      onOpenChange(false);
      onCompleted?.(data.message || "Moved draft to Missed Trades and archived.");
    } catch (err: any) {
      setError(err?.message || "Failed to move draft to Missed Trades");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 text-base font-bold">
          <FileText className="h-4 w-4 text-indigo-400" />
          <span>Confirm Notebook Scratchpad Transfer &amp; Auto-Archive</span>
        </DialogTitle>
        <DialogDescription className="text-xs">
          Assign your temporary Notebook trade draft(s) (including screenshots) to a synced Trade or
          Missed Trade. Transferred notes are automatically moved to{" "}
          <strong>Archived (auto-deleted after 14 days)</strong>.
        </DialogDescription>

        {/* Mode Toggle: Move to Synced Trade(s) vs Move to Missed Trades */}
        <div className="flex items-center gap-2 border-b border-border/60 pb-3 pt-1">
          <button
            type="button"
            onClick={() => setMode("trade")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              mode === "trade"
                ? "bg-indigo-600 text-white shadow"
                : "bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            Move to Synced Trade(s) (Supports Multi-Entry Mapping)
          </button>
          <button
            type="button"
            onClick={() => setMode("missed")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              mode === "missed"
                ? "bg-amber-600 text-white shadow"
                : "bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            Send to Missed Trades (Setup Did Not Trigger)
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-indigo-400" />
            Scanning unarchived Notebook drafts and recent trades...
          </div>
        ) : notes.length === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            No unarchived Notebook drafts found. Create a note in the Notebook first!
          </div>
        ) : mode === "trade" ? (
          <div className="space-y-3 text-xs">
            <div className="text-[11px] text-muted-foreground flex items-center justify-between">
              <span>
                Check the Notebook draft(s) you want to move and confirm which Trade each draft belongs to:
              </span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {selectedCount} selected
              </Badge>
            </div>

            <div className="divide-y divide-border/50 rounded-xl border border-border/70 bg-secondary/15 max-h-[420px] overflow-y-auto">
              {notes.map((n) => {
                const cfg = mappings[n.id] || {
                  selected: false,
                  tradeKey: trades[0]?.key || "",
                  targetSection: "setup",
                };
                const plainPreview = (n.content || "")
                  .replace(/<[^>]+>/g, " ")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 110);
                const hasImages = /<img\s/i.test(n.content || "");

                return (
                  <div
                    key={n.id}
                    className={`p-3 space-y-2.5 transition ${
                      cfg.selected ? "bg-indigo-500/10" : "hover:bg-secondary/25"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <label className="flex items-start gap-2.5 cursor-pointer min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={cfg.selected}
                          onChange={(e) =>
                            setMappings((prev) => ({
                              ...prev,
                              [n.id]: { ...cfg, selected: e.target.checked },
                            }))
                          }
                          className="mt-0.5 h-4 w-4 accent-indigo-500 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-foreground flex flex-wrap items-center gap-1.5">
                            <span className="truncate">{n.title || "Untitled Draft"}</span>
                            {hasImages && (
                              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                                📷 Contains Screenshot(s)
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            Updated: {formatDateDMY((n.updatedAt || "").slice(0, 16).replace("T", " "))}
                          </div>
                          {plainPreview && (
                            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                              {plainPreview}
                            </p>
                          )}
                        </div>
                      </label>
                    </div>

                    {cfg.selected && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-6 pt-1">
                        <div className="sm:col-span-2 space-y-1">
                          <label className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                            <ArrowRight className="h-3 w-3 text-indigo-400" />
                            <span>Target Trade for "{n.title || "Untitled"}":</span>
                          </label>
                          <select
                            value={cfg.tradeKey}
                            onChange={(e) =>
                              setMappings((prev) => ({
                                ...prev,
                                [n.id]: { ...cfg, tradeKey: e.target.value },
                              }))
                            }
                            className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground"
                          >
                            {trades.map((t) => {
                              const dt = formatDateDMY((t.openedAt || "").slice(0, 16).replace("T", " "));
                              const pnlStr =
                                t.netPnl >= 0 ? `+$${t.netPnl.toFixed(2)}` : `-$${Math.abs(t.netPnl).toFixed(2)}`;
                              return (
                                <option key={t.key} value={t.key}>
                                  {dt} · {t.symbol} {t.direction.toUpperCase()} ({pnlStr})
                                  {t.hasNotes ? " [Has Notes]" : ""}
                                </option>
                              );
                            })}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-muted-foreground">
                            Destination Section:
                          </label>
                          <select
                            value={cfg.targetSection}
                            onChange={(e) =>
                              setMappings((prev) => ({
                                ...prev,
                                [n.id]: {
                                  ...cfg,
                                  targetSection: e.target.value as "setup" | "review",
                                },
                              }))
                            }
                            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"
                          >
                            <option value="setup">Execution &amp; Setup Notes</option>
                            <option value="review">Post-Trade Review</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Archive className="h-3.5 w-3.5 text-indigo-400" />
                <span>Moved notes are archived immediately and deleted automatically after 14 days.</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={submitting || selectedCount === 0}
                  onClick={() => void handleConfirmTransferToTrades()}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Confirm &amp; Move {selectedCount} Draft{selectedCount === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* MODE: SEND TO MISSED TRADES */
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-foreground">Select Notebook Draft</label>
              <select
                value={missedNoteId}
                onChange={(e) => setMissedNoteId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                {notes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {formatDateDMY((n.updatedAt || "").slice(0, 10))} · {n.title || "Untitled"}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-foreground">Symbol</label>
                <Input
                  value={missedSymbol}
                  onChange={(e) => setMissedSymbol(e.target.value.toUpperCase())}
                  placeholder="NAS100"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-foreground">Direction</label>
                <select
                  value={missedDirection}
                  onChange={(e) => setMissedDirection(e.target.value as "long" | "short")}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                >
                  <option value="long">LONG</option>
                  <option value="short">SHORT</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-foreground">Setup / Reason Missed</label>
                <Input
                  value={missedReason}
                  onChange={(e) => setMissedReason(e.target.value)}
                  placeholder="e.g. Did not tap OTE / Hesitated"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground">
                Creates a Missed Trade entry with your screenshots and archives the Notebook note (14d auto-delete).
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={submitting || !missedNoteId}
                  onClick={() => void handleConfirmTransferToMissed()}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-semibold"
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Confirm &amp; Move to Missed Trades
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

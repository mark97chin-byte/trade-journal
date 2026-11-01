"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Terminal, RefreshCw, X, Square, Cpu } from "lucide-react";

interface AiLogButtonProps {
  className?: string;
  label?: string;
  onAborted?: () => void;
}

export function AiLogButton({
  className = "",
  label = "Logs",
  onAborted,
}: AiLogButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logTail, setLogTail] = useState("");
  const [online, setOnline] = useState(false);
  const [modelName, setModelName] = useState("");
  const [activeJobs, setActiveJobs] = useState<Array<{ id: string; jobType: string; label: string; startedAt: string }>>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogsAndStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "daemon_status" }),
      });
      const json = await res.json();
      if (json.ok) {
        setLogTail(json.logTail || "");
        setOnline(Boolean(json.online));
        setModelName(json.loadedModel || "");
        if (Array.isArray(json.activeJobs)) {
          setActiveJobs(json.activeJobs);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchLogsAndStatus();
    const interval = setInterval(() => {
      void fetchLogsAndStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, [open, fetchLogsAndStatus]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const handleAbortAll = async () => {
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_job" }),
      });
      await fetchLogsAndStatus();
      onAborted?.();
    } catch {}
  };

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
          open
            ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-300"
            : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground hover:bg-secondary"
        }`}
        title="View live KoboldCpp GPU logs & active background AI jobs"
      >
        <Terminal className="h-3 w-3 text-indigo-400" />
        <span>{label}</span>
        {activeJobs.length > 0 && (
          <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[360px] sm:w-[460px] rounded-xl border border-border bg-[#0d0f14] p-3 shadow-2xl text-xs space-y-2.5">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              <span className="font-bold text-foreground">Desktop GPU Live Console</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  online
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                }`}
              >
                {online ? `Online · ${modelName || "KoboldCpp"}` : "Offline"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void fetchLogsAndStatus()}
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="Refresh logs"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {activeJobs.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 text-amber-200 truncate">
                <RefreshCw className="h-3 w-3 animate-spin shrink-0 text-amber-400" />
                <span className="truncate">
                  Generating: <strong>{activeJobs[0]?.label || activeJobs[0]?.jobType}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleAbortAll()}
                className="inline-flex items-center gap-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 px-2 py-0.5 text-[10px] font-semibold text-rose-300 shrink-0"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>Cancel</span>
              </button>
            </div>
          )}

          <pre className="max-h-60 min-h-[120px] overflow-y-auto rounded-lg border border-border/50 bg-black/90 p-2.5 font-mono text-[10px] text-emerald-300/90 whitespace-pre-wrap leading-relaxed">
            {logTail || "No console output yet. Start the desktop server or trigger an AI prompt."}
          </pre>

          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
            <span>Auto-refreshes every 2s while open</span>
            <button
              type="button"
              onClick={() => void handleAbortAll()}
              className="text-rose-400 hover:underline font-medium"
            >
              Force Abort Generation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

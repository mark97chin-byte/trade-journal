"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  FileText,
  Sparkles,
  Save,
  CheckSquare,
  Square,
  Target,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  ArrowDownToLine,
} from "lucide-react";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { VoiceNote } from "@/components/voice-note";
import { ReviewExport } from "@/components/review-export";
import type { JournalEntryRecord } from "@/server/journal-service";
import type { JournalTrade } from "./journal-view";

interface JournalEntryEditorProps {
  initialEntry: JournalEntryRecord;
  trades: JournalTrade[];
  range: {
    periodType: "day" | "week" | "month" | "quarter" | "year";
    startDate: string;
    endDate: string;
    anchorDate: string;
    defaultTitle: string;
  };
}

const fmtCurrency = (val: number) => {
  const abs = Math.abs(val);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (val > 0) return `+${formatted}`;
  if (val < 0) return `-${formatted}`;
  return formatted;
};

function getMondayStr(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

const DEFAULT_CHECKLIST_ITEMS = [
  { id: "htf_narrative", label: "Mapped HTF Draw on Liquidity & Daily Relevant Swing" },
  { id: "session_timing", label: "Waited for key session window / 7H profile alignment" },
  { id: "purge_confirmation", label: "Waited for liquidity sweep + displacement before entry" },
  { id: "risk_respected", label: "Sized position properly & respected hard stop loss" },
  { id: "no_fomo_revenge", label: "Zero impulse, FOMO, or revenge executions" },
];

const NOTION_HTML_TEMPLATES: Record<string, { label: string; html: string }> = {
  daily_ict: {
    label: "Daily Narrative & Execution",
    html: `
<div class="tz-callout tz-color-blue_background" data-notion-type="callout" data-notion-color="blue_background" data-icon="🎯">
  <span class="tz-callout-icon" contenteditable="false">🎯</span>
  <div class="tz-callout-content">
    <div><strong>Pre-Market HTF Narrative &amp; Draw on Liquidity (DOL)</strong></div>
    <div>Map Daily/4H bias, key liquidity pools (PDH/PDL, BSL/SSL), and 7H candle profile expectations.</div>
  </div>
</div>
<div class="tz-column-list" data-notion-type="column_list" data-columns="2">
  <div class="tz-column" data-notion-type="column">
    <div class="tz-toggle tz-toggle-h3" data-notion-type="heading_3" data-toggle-type="heading_3" data-open="true">
      <div class="tz-toggle-header">
        <span class="tz-toggle-btn" contenteditable="false">▾</span>
        <div class="tz-toggle-title"><strong>Key Levels &amp; Pools</strong></div>
      </div>
      <div class="tz-toggle-body">
        <ul>
          <li><strong>Buy-Side Liquidity (BSL):</strong> </li>
          <li><strong>Sell-Side Liquidity (SSL):</strong> </li>
          <li><strong>Relevant Swings:</strong> </li>
        </ul>
      </div>
    </div>
  </div>
  <div class="tz-column" data-notion-type="column">
    <div class="tz-toggle tz-toggle-h3" data-notion-type="heading_3" data-toggle-type="heading_3" data-open="true">
      <div class="tz-toggle-header">
        <span class="tz-toggle-btn" contenteditable="false">▾</span>
        <div class="tz-toggle-title"><strong>Session Delivery Triggers</strong></div>
      </div>
      <div class="tz-toggle-body">
        <ul>
          <li><strong>Judas / Sweep:</strong> </li>
          <li><strong>Entry Model (MMXM / Purge):</strong> </li>
          <li><strong>Partials Target Plan:</strong> </li>
        </ul>
      </div>
    </div>
  </div>
</div>
<hr class="tz-divider" data-notion-type="divider" />
<div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title"><strong>📝 Post-Session Audit &amp; Psychology</strong></div>
  </div>
  <div class="tz-toggle-body">
    <p><strong>What went exactly according to plan:</strong> </p>
    <p><strong>Where did hesitation or execution friction occur:</strong> </p>
    <p><strong>One concrete rule adjustment for tomorrow:</strong> </p>
  </div>
</div>
<p><br/></p>
`,
  },
  weekly_review: {
    label: "Weekly Edge Synthesis",
    html: `
<div class="tz-callout tz-color-purple_background" data-notion-type="callout" data-notion-color="purple_background" data-icon="📊">
  <span class="tz-callout-icon" contenteditable="false">📊</span>
  <div class="tz-callout-content">
    <div><strong>Weekly Edge &amp; Execution Synthesis</strong></div>
    <div>Review performance distribution, system adherence, and primary session observations.</div>
  </div>
</div>
<div class="tz-column-list" data-notion-type="column_list" data-columns="2">
  <div class="tz-column" data-notion-type="column">
    <h3>🏆 A+ Setups Taken</h3>
    <div class="tz-check-row" data-notion-type="to_do">
      <input type="checkbox" class="tz-inline-checkbox" checked="checked" />
      <div class="tz-check-text">Followed higher timeframe DOL</div>
    </div>
    <div class="tz-check-row" data-notion-type="to_do">
      <input type="checkbox" class="tz-inline-checkbox" checked="checked" />
      <div class="tz-check-text">Respected session timing windows</div>
    </div>
  </div>
  <div class="tz-column" data-notion-type="column">
    <h3>⚠️ Areas for Refinement</h3>
    <p>Document any off-plan trades, drawdown drivers, or scaling mistakes...</p>
  </div>
</div>
<hr class="tz-divider" data-notion-type="divider" />
<div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title"><strong>🎯 Primary Goal for Next Week</strong></div>
  </div>
  <div class="tz-toggle-body">
    <p>Key discipline filter to carry into the upcoming week...</p>
  </div>
</div>
<p><br/></p>
`,
  },
  mistake_audit: {
    label: "Error / Tilt Audit",
    html: `
<div class="tz-callout tz-color-red_background" data-notion-type="callout" data-notion-color="red_background" data-icon="🚨">
  <span class="tz-callout-icon" contenteditable="false">🚨</span>
  <div class="tz-callout-content">
    <div><strong>Execution Error &amp; Tilt Root-Cause Audit</strong></div>
    <div>Isolate system losses from unforced psychological errors.</div>
  </div>
</div>
<blockquote class="tz-quote" data-notion-type="quote">
  <div><strong>Root Cause:</strong> Was this a valid system loss or a rule violation (FOMO, over-leverage, boredom)?</div>
</blockquote>
<p><strong>Market Condition During Trade:</strong> </p>
<p><strong>Emotional Trigger Preceding Entry:</strong> </p>
<p><strong>If-Then Rule to Prevent Recurrence:</strong> </p>
<p><br/></p>
`,
  },
};

export function JournalEntryEditor({
  initialEntry,
  trades,
  range,
}: JournalEntryEditorProps) {
  const router = useRouter();
  const noteEditorRef = useRef<RichEditorHandle>(null);

  const [title, setTitle] = useState(initialEntry.title);
  const [content, setContent] = useState(initialEntry.content);
  const [marketBias, setMarketBias] = useState(initialEntry.marketBias || "Neutral");
  const [dayProfile, setDayProfile] = useState(initialEntry.dayProfile || "");
  const [keyLevels, setKeyLevels] = useState(initialEntry.keyLevels || "");
  const [lessonsLearned, setLessonsLearned] = useState(
    initialEntry.lessonsLearned || ""
  );
  const [notionUrl, setNotionUrl] = useState<string | null>(
    initialEntry.notionUrl ||
      (initialEntry.notionPageId
        ? `https://www.notion.so/${initialEntry.notionPageId.replace(/-/g, "")}`
        : null)
  );

  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(initialEntry.checklistJson || "{}");
    } catch {
      return {};
    }
  });

  const [scores, setScores] = useState<{
    planAdherence: number;
    execution: number;
    riskMgmt: number;
    mentalState: number;
  }>(() => {
    try {
      const parsed = JSON.parse(initialEntry.scoresJson || "{}");
      return {
        planAdherence: parsed.planAdherence ?? 4,
        execution: parsed.execution ?? 4,
        riskMgmt: parsed.riskMgmt ?? 4,
        mentalState: parsed.mentalState ?? 4,
      };
    } catch {
      return { planAdherence: 4, execution: 4, riskMgmt: 4, mentalState: 4 };
    }
  });

  const [saving, setSaving] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    setTitle(initialEntry.title);
    setContent(initialEntry.content);
    setMarketBias(initialEntry.marketBias || "Neutral");
    setDayProfile(initialEntry.dayProfile || "");
    setKeyLevels(initialEntry.keyLevels || "");
    setLessonsLearned(initialEntry.lessonsLearned || "");
    setNotionUrl(
      initialEntry.notionUrl ||
        (initialEntry.notionPageId
          ? `https://www.notion.so/${initialEntry.notionPageId.replace(/-/g, "")}`
          : null)
    );
    try {
      setChecklist(JSON.parse(initialEntry.checklistJson || "{}"));
    } catch {
      setChecklist({});
    }
    try {
      const parsed = JSON.parse(initialEntry.scoresJson || "{}");
      setScores({
        planAdherence: parsed.planAdherence ?? 4,
        execution: parsed.execution ?? 4,
        riskMgmt: parsed.riskMgmt ?? 4,
        mentalState: parsed.mentalState ?? 4,
      });
    } catch {}
  }, [initialEntry]);

  // Persist and reuse active date anchor across Day / Week / Month / Quarter / Year
  const [activeAnchor, setActiveAnchor] = useState<string>(range.anchorDate);

  useEffect(() => {
    // If we are on a day or week page, this is our authoritative active anchor
    if (range.periodType === "day" || range.periodType === "week") {
      setActiveAnchor(range.anchorDate);
      try {
        localStorage.setItem("tz_active_journal_anchor", range.anchorDate);
      } catch {}
      return;
    }

    // When on month, quarter, or year, check if we have a saved anchor from our previous daily browsing
    try {
      const saved = localStorage.getItem("tz_active_journal_anchor");
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        // If the saved anchor belongs to the same year/month as this view, keep it
        const currentYear = range.anchorDate.slice(0, 4);
        if (range.periodType === "year") {
          // If viewing year-2026, keep saved anchor if it's in 2026
          if (saved.startsWith(currentYear)) {
            setActiveAnchor(saved);
            return;
          }
        } else if (range.periodType === "month") {
          // If viewing month-2026-09, keep saved anchor if it's in 2026-09
          const currentMonth = range.anchorDate.slice(0, 7);
          if (saved.startsWith(currentMonth)) {
            setActiveAnchor(saved);
            return;
          }
        } else if (range.periodType === "quarter") {
          const currentYear = range.anchorDate.slice(0, 4);
          const qNum = Math.floor((parseInt(range.anchorDate.slice(5, 7), 10) - 1) / 3) + 1;
          const savedMonth = parseInt(saved.slice(5, 7), 10);
          const savedQ = Math.floor((savedMonth - 1) / 3) + 1;
          if (saved.startsWith(currentYear) && savedQ === qNum) {
            setActiveAnchor(saved);
            return;
          }
        }
      }
    } catch {}

    setActiveAnchor(range.anchorDate);
  }, [range.periodType, range.anchorDate]);

  const hierarchyLinks = useMemo(() => {
    const anchor = activeAnchor || range.anchorDate;
    const yr = anchor.slice(0, 4);
    const mo = anchor.slice(0, 7);
    const monthNum = parseInt(anchor.slice(5, 7), 10);
    const qNum = Math.floor((monthNum - 1) / 3) + 1;
    const mondayStr = getMondayStr(anchor);

    return [
      {
        type: "day" as const,
        label: `Day (${anchor.slice(5)})`,
        href: `/journal/${anchor}`,
      },
      {
        type: "week" as const,
        label: `Week (${mondayStr.slice(5)})`,
        href: `/journal/week-${mondayStr}`,
      },
      {
        type: "month" as const,
        label: `Month (${mo})`,
        href: `/journal/month-${mo}`,
      },
      {
        type: "quarter" as const,
        label: `Quarter (${yr}-Q${qNum})`,
        href: `/journal/quarter-${yr}-Q${qNum}`,
      },
      {
        type: "year" as const,
        label: `Year (${yr})`,
        href: `/journal/year-${yr}`,
      },
    ];
  }, [activeAnchor, range.anchorDate]);

  const adjacentSlugs = useMemo(() => {
    const d = new Date(`${range.anchorDate}T12:00:00Z`);
    if (range.periodType === "day") {
      const prev = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
      const next = new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
      return { prev: `/journal/${prev}`, next: `/journal/${next}` };
    }
    if (range.periodType === "week") {
      const prev = new Date(d.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
      const next = new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
      return { prev: `/journal/week-${prev}`, next: `/journal/week-${next}` };
    }
    if (range.periodType === "month") {
      const prevM = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
        .toISOString()
        .slice(0, 7);
      const nextM = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 7);
      return { prev: `/journal/month-${prevM}`, next: `/journal/month-${nextM}` };
    }
    if (range.periodType === "quarter") {
      const yr = d.getUTCFullYear();
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const prevQ = q === 1 ? `${yr - 1}-Q4` : `${yr}-Q${q - 1}`;
      const nextQ = q === 4 ? `${yr + 1}-Q1` : `${yr}-Q${q + 1}`;
      return { prev: `/journal/quarter-${prevQ}`, next: `/journal/quarter-${nextQ}` };
    }
    const yr = d.getUTCFullYear();
    return {
      prev: `/journal/year-${yr - 1}`,
      next: `/journal/year-${yr + 1}`,
    };
  }, [range]);

  const stats = useMemo(() => {
    const total = trades.length;
    const wins = trades.filter((t) => t.netPnl > 0);
    const losses = trades.filter((t) => t.netPnl < 0);
    const netPnl = trades.reduce((acc, t) => acc + t.netPnl, 0);
    const grossPnl = trades.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0);
    const fees = trades.reduce((acc, t) => acc + (t.fees ?? 0), 0);
    const volume = trades.reduce((acc, t) => acc + (t.quantity || 0), 0);
    const totalR = trades.reduce((acc, t) => acc + (t.realizedR ?? 0), 0);

    const grossWin = wins.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0);
    const grossLoss = Math.abs(
      losses.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0)
    );
    const profitFactor =
      grossLoss > 0
        ? (grossWin / grossLoss).toFixed(2)
        : grossWin > 0
        ? "∞"
        : "0.00";
    const winRate = total > 0 ? ((wins.length / total) * 100).toFixed(1) : "0.0";

    const sorted = [...trades].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
    );
    let running = 0;
    let maxPeak = 0;
    let maxDd = 0;
    const curvePts = [{ x: 0, y: 0 }];
    sorted.forEach((t, i) => {
      running += t.netPnl;
      if (running > maxPeak) maxPeak = running;
      if (running < maxDd) maxDd = running;
      curvePts.push({ x: i + 1, y: running });
    });

    const bestTrade =
      trades.length > 0
        ? [...trades].sort((a, b) => b.netPnl - a.netPnl)[0]
        : null;
    const worstTrade =
      trades.length > 0
        ? [...trades].sort((a, b) => a.netPnl - b.netPnl)[0]
        : null;

    return {
      total,
      winsCount: wins.length,
      lossesCount: losses.length,
      netPnl,
      grossPnl,
      fees,
      volume,
      totalR,
      profitFactor,
      winRate,
      maxPeak,
      maxDd,
      curvePts,
      bestTrade,
      worstTrade,
    };
  }, [trades]);

  const processScorePct = useMemo(() => {
    const sum =
      scores.planAdherence +
      scores.execution +
      scores.riskMgmt +
      scores.mentalState;
    return Math.round((sum / 20) * 100);
  }, [scores]);

  const sectionTitle = useMemo(() => {
    switch (range.periodType) {
      case "week":
        return "Weekly Synthesis & Edge Review";
      case "month":
        return "Monthly Performance & Macro Review";
      case "quarter":
        return "Quarterly Milestone & Strategy Review";
      case "year":
        return "Annual Trading Performance & System Audit";
      default:
        return "Daily Session Notes & Execution Review";
    }
  }, [range.periodType]);

  const [pullingNotion, setPullingNotion] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const handlePullFromNotion = useCallback(async () => {
    setPullingNotion(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`/api/journal/${initialEntry.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pullFromNotion: true,
          notionPageId: initialEntry.notionPageId,
          title,
        }),
      });
      const data = await res.json();
      if (data.notionPulled && data.entry) {
        setTitle(data.entry.title);
        setContent(data.entry.content);
        if (data.entry.notionUrl) setNotionUrl(data.entry.notionUrl);
        setEditorKey((k) => k + 1);
        setSaveStatus("Pulled latest content from Notion!");
      } else {
        setSaveStatus(data.notionError || "Could not pull from Notion");
      }
    } catch {
      setSaveStatus("Error connecting to Notion");
    } finally {
      setPullingNotion(false);
    }
  }, [initialEntry.slug, initialEntry.notionPageId, title]);

  const handleSave = useCallback(
    async (syncNotion = false) => {
      if (syncNotion) setSyncingNotion(true);
      else setSaving(true);
      setSaveStatus(null);

      try {
        const res = await fetch(`/api/journal/${initialEntry.slug}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            marketBias,
            dayProfile,
            keyLevels,
            lessonsLearned,
            checklistJson: JSON.stringify(checklist),
            scoresJson: JSON.stringify(scores),
            rating: processScorePct,
            syncNotion,
          }),
        });
        const data = await res.json();
        if (data.entry?.notionUrl) {
          setNotionUrl(data.entry.notionUrl);
        }
        if (syncNotion) {
          if (data.notionSynced) {
            setSaveStatus("Saved & Synced to Notion!");
          } else {
            setSaveStatus(data.notionError || "Saved locally (Notion sync skipped)");
          }
        } else {
          setSaveStatus("Saved to database");
        }
      } catch (e: any) {
        setSaveStatus("Error saving journal");
      } finally {
        setSaving(false);
        setSyncingNotion(false);
      }
    },
    [
      initialEntry.slug,
      title,
      content,
      marketBias,
      dayProfile,
      keyLevels,
      lessonsLearned,
      checklist,
      scores,
      processScorePct,
    ]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const insertTemplateHtml = (key: string) => {
    const tpl = NOTION_HTML_TEMPLATES[key];
    if (!tpl) return;
    if (noteEditorRef.current?.insertHtml) {
      noteEditorRef.current.insertHtml(tpl.html);
    } else {
      setContent((prev) => (prev ? `${prev}<br/>${tpl.html}` : tpl.html));
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/journal"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Overview</span>
          </Link>

          <div className="flex items-center rounded-lg border border-border/60 bg-secondary/50 p-0.5">
            <button
              onClick={() => router.push(adjacentSlugs.prev)}
              title="Previous Period"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {range.periodType}
            </span>
            <button
              onClick={() => router.push(adjacentSlugs.next)}
              title="Next Period"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center rounded-xl bg-secondary/50 p-1 border border-border/60">
            {hierarchyLinks.map((link) => {
              const isActive = range.periodType === link.type;
              return (
                <Link
                  key={link.type}
                  href={link.href}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                    isActive
                      ? "bg-secondary text-foreground border border-border font-medium text-foreground shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus && (
            <span className="text-xs text-profit flex items-center gap-1 mr-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {saveStatus}
            </span>
          )}

          <a
            href={notionUrl || "https://www.notion.so"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/70 hover:bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition"
            title={notionUrl ? "Open linked page in Notion" : "Open Notion"}
          >
            <span>Open in Notion</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={handlePullFromNotion}
            disabled={pullingNotion || syncingNotion || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/70 hover:bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition disabled:opacity-50"
            title="Pull blocks & notes from Notion into this journal"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            <span>{pullingNotion ? "Pulling..." : "Pull from Notion"}</span>
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={syncingNotion || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/70 hover:bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition disabled:opacity-50"
          >
            <CloudUpload className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{syncingNotion ? "Syncing Notion..." : "Sync to Notion"}</span>
          </button>

          <button
            onClick={() => handleSave(false)}
            disabled={saving || syncingNotion}
            className="inline-flex items-center gap-1.5 rounded-lg bg-secondary text-foreground border border-border font-medium hover:bg-secondary text-foreground border border-border font-medium px-3.5 py-1.5 text-xs font-semibold text-foreground shadow transition disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? "Saving..." : "Save (Ctrl+S)"}</span>
          </button>
        </div>
      </div>

      {/* STATS BANNER */}
      <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-border/40">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-muted-foreground" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -ml-1"
              placeholder="Journal Title..."
            />
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground mr-1.5">Net P&L:</span>
              <span
                className={`font-bold ${
                  stats.netPnl >= 0 ? "text-profit" : "text-loss"
                }`}
              >
                {fmtCurrency(stats.netPnl)}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground mr-1.5">Realized R:</span>
              <span
                className={`font-bold ${
                  stats.totalR >= 0 ? "text-profit" : "text-loss"
                }`}
              >
                {stats.totalR > 0 ? `+${stats.totalR.toFixed(2)}R` : `${stats.totalR.toFixed(2)}R`}
              </span>
            </div>
            <div className="px-2.5 py-0.5 rounded-full bg-secondary text-foreground border border-border font-medium/15 border border-indigo-500/30 text-xs font-semibold text-foreground">
              Process Score: {processScorePct}%
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 items-center">
          <div className="lg:col-span-4 border-r-0 lg:border-r border-slate-200 dark:border-border/40 pr-0 lg:pr-5">
            {stats.curvePts.length > 1 ? (
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Intraday / Period P&L Curve</span>
                  <span>
                    Peak: {fmtCurrency(stats.maxPeak)} | Low: {fmtCurrency(stats.maxDd)}
                  </span>
                </div>
                <svg viewBox="0 0 260 65" className="w-full h-16 overflow-visible">
                  {(() => {
                    const minY = Math.min(0, ...stats.curvePts.map((p) => p.y));
                    const maxY = Math.max(0, ...stats.curvePts.map((p) => p.y));
                    const spanY = Math.max(maxY - minY, 10);
                    const maxX = stats.curvePts.length - 1;
                    const getX = (x: number) => (x / maxX) * 250 + 5;
                    const getY = (y: number) => 55 - ((y - minY) / spanY) * 45;
                    const zeroY = getY(0);
                    const path = stats.curvePts
                      .map(
                        (p, idx) =>
                          `${idx === 0 ? "M" : "L"} ${getX(p.x).toFixed(1)} ${getY(p.y).toFixed(1)}`
                      )
                      .join(" ");
                    const isWin = stats.netPnl >= 0;
                    return (
                      <>
                        <line
                          x1="0"
                          y1={zeroY}
                          x2="260"
                          y2={zeroY}
                          stroke="#474d66"
                          strokeDasharray="3 3"
                          strokeWidth="1"
                        />
                        <path
                          d={path}
                          fill="none"
                          stroke={isWin ? "#34d399" : "#fb7185"}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </>
                    );
                  })()}
                </svg>
              </div>
            ) : (
              <div className="h-16 flex items-center justify-center text-xs text-muted-foreground/50 border border-dashed border-slate-200 dark:border-border/40 rounded-lg">
                No closed trades recorded in this period
              </div>
            )}
          </div>

          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-6 text-xs">
            <div>
              <div className="text-muted-foreground text-[10px]">Total Trades</div>
              <div className="font-semibold text-sm text-foreground">{stats.total}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Win Rate</div>
              <div className="font-semibold text-sm text-foreground">
                {stats.winRate}% ({stats.winsCount}W / {stats.lossesCount}L)
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Profit Factor</div>
              <div className="font-semibold text-sm text-foreground">
                {stats.profitFactor}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Volume / Fees</div>
              <div className="font-semibold text-sm text-foreground">
                {stats.volume.toFixed(2)}L • ${stats.fees.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Gross P&L</div>
              <div
                className={`font-semibold text-sm ${
                  stats.grossPnl >= 0 ? "text-profit" : "text-loss"
                }`}
              >
                {fmtCurrency(stats.grossPnl)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Max Profit Peak</div>
              <div className="font-semibold text-sm text-profit">
                {fmtCurrency(stats.maxPeak)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Max Drawdown</div>
              <div className="font-semibold text-sm text-loss">
                {fmtCurrency(stats.maxDd)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Best / Worst Trade</div>
              <div className="font-semibold text-xs tabular-nums">
                <span className="text-profit">
                  {stats.bestTrade ? fmtCurrency(stats.bestTrade.netPnl) : "—"}
                </span>{" "}
                /{" "}
                <span className="text-loss">
                  {stats.worstTrade ? fmtCurrency(stats.worstTrade.netPnl) : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NOTES WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-border/40">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-bold text-foreground">
                  {sectionTitle}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <VoiceNote
                  onPrepare={() => noteEditorRef.current?.focus()}
                  onText={(text) => {
                    const formatted = ` ${text}`;
                    if (noteEditorRef.current?.insertText) {
                      noteEditorRef.current.insertText(formatted);
                    } else {
                      setContent((prev) => `${prev || ""}${formatted}`);
                    }
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  HTF Market Bias
                </label>
                <select
                  value={marketBias}
                  onChange={(e) => setMarketBias(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-[#181b26] px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="Bullish">Bullish (Expansion Higher)</option>
                  <option value="Bearish">Bearish (Expansion Lower)</option>
                  <option value="Neutral">Neutral / Two-Sided Range</option>
                  <option value="Reversal">HTF Reversal / Sweep</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Session / Day Profile
                </label>
                <input
                  value={dayProfile}
                  onChange={(e) => setDayProfile(e.target.value)}
                  placeholder="e.g. London Manipulation -> NY AM Continuation"
                  className="w-full rounded-lg border border-border/60 bg-[#181b26] px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Key Draw on Liquidity / Levels
                </label>
                <input
                  value={keyLevels}
                  onChange={(e) => setKeyLevels(e.target.value)}
                  placeholder="e.g. US500 7785 BSL / 7760 SSL"
                  className="w-full rounded-lg border border-border/60 bg-[#181b26] px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* FULL NOTION RICH EDITOR */}
            <div className="pt-1">
              <RichEditor key={editorKey}
                editorRef={noteEditorRef}
                value={content}
                onChange={setContent}
                minHeight={460}
                ownerType="day"
                ownerId={initialEntry.slug}
                placeholder="Type '/' for Notion blocks (toggles, columns, callouts, images) or paste screenshots (Ctrl+V)..."
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Key Takeaway / Primary Focus for Next Session
              </label>
              <input
                value={lessonsLearned}
                onChange={(e) => setLessonsLearned(e.target.value)}
                placeholder="One concrete rule or adjustment to carry into the next session..."
                className="w-full rounded-lg border border-indigo-500/30 bg-indigo-950/15 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="pt-2 border-t border-border/30 space-y-3">
              <ReviewExport
                containsFinancialData
                document={{
                  title: `${initialEntry.title || range.defaultTitle}`,
                  subtitle: `${range.periodType.toUpperCase()} (${range.startDate} to ${range.endDate})`,
                  lines: [
                    `Trades: ${stats.total} | Win Rate: ${stats.winRate}%`,
                    `Net P&L: ${fmtCurrency(stats.netPnl)} | Realized R: ${stats.totalR.toFixed(2)}R`,
                    `HTF Bias: ${marketBias} | Profile: ${dayProfile || "Unspecified"}`,
                    `Key DOL: ${keyLevels || "Unspecified"}`,
                    `Focus: ${lessonsLearned || "None"}`,
                    "",
                    content,
                  ],
                }}
              />
              {/* Legacy attachment drawer removed: images are managed inline in the block editor */}
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-border/40 pb-2.5">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-bold text-foreground">
                  Execution &amp; Process Scorecard
                </h3>
              </div>
              <span className="text-xs font-bold text-muted-foreground">
                {processScorePct}%
              </span>
            </div>

            {(
              [
                { key: "planAdherence", label: "Plan & Setup Adherence" },
                { key: "execution", label: "Entry & Partial Timing" },
                { key: "riskMgmt", label: "Risk & Stop Discipline" },
                { key: "mentalState", label: "Mental & Emotional Composure" },
              ] as const
            ).map((item) => (
              <div key={item.key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-semibold text-foreground">
                    {scores[item.key]} / 5
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((val) => {
                    const active = scores[item.key] >= val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() =>
                          setScores((prev) => ({ ...prev, [item.key]: val }))
                        }
                        className={`h-2 rounded-full transition ${
                          active
                            ? scores[item.key] >= 4
                              ? "bg-profit/15 text-profit"
                              : scores[item.key] === 3
                              ? "bg-amber-500"
                              : "bg-loss/15 text-loss"
                            : "bg-muted/40 hover:bg-muted"
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-border/40 pb-2.5">
              <ShieldCheck className="w-4 h-4 text-profit" />
              <h3 className="text-sm font-bold text-foreground">
                Trading Plan Checklist
              </h3>
            </div>

            <div className="space-y-2">
              {DEFAULT_CHECKLIST_ITEMS.map((item) => {
                const checked = !!checklist[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setChecklist((prev) => ({
                        ...prev,
                        [item.id]: !prev[item.id],
                      }))
                    }
                    className={`w-full flex items-start gap-2.5 p-2 rounded-lg border text-left text-xs transition ${
                      checked
                        ? "border-profit/20 bg-emerald-950/20 text-foreground"
                        : "border-slate-200 dark:border-border/40 bg-[#161924]/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-profit shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    <span className="leading-snug">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* EXECUTED TRADES TABLE */}
      <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-bold text-foreground">
              Executed Trades ({trades.length})
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Click any trade to inspect its 1m chart replay &amp; running P&amp;L excursion
          </span>
        </div>

        {trades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-slate-200 dark:border-border/40">
                  <th className="py-2 px-2.5 font-medium">Opened (NY)</th>
                  <th className="py-2 px-2.5 font-medium">Symbol</th>
                  <th className="py-2 px-2.5 font-medium">Side</th>
                  <th className="py-2 px-2.5 font-medium text-right">Volume</th>
                  <th className="py-2 px-2.5 font-medium text-right">Entry → Exit</th>
                  <th className="py-2 px-2.5 font-medium text-right">Realized R</th>
                  <th className="py-2 px-2.5 font-medium text-right">Net P&amp;L</th>
                  <th className="py-2 px-2.5 font-medium">Partials / Notes</th>
                  <th className="py-2 px-2.5 font-medium text-right">Replay</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const isBuy =
                    t.direction.toLowerCase() === "buy" ||
                    t.direction.toLowerCase() === "long";
                  const datePart = t.openedAt.slice(0, 10);
                  const timePart =
                    t.openedAt.length >= 16 ? t.openedAt.slice(11, 19) : "";

                  return (
                    <tr
                      key={t.key}
                      className="border-b border-border/20 hover:bg-muted/20 transition"
                    >
                      <td className="py-2.5 px-2.5 tabular-nums text-muted-foreground">
                        {datePart} <span className="text-foreground font-medium">{timePart}</span>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span className="px-2 py-0.5 rounded bg-secondary text-foreground font-semibold text-[11px]">
                          {t.symbol}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span
                          className={`font-bold text-[11px] uppercase ${
                            isBuy ? "text-profit" : "text-loss"
                          }`}
                        >
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums text-foreground">
                        {t.quantity}L
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums text-muted-foreground">
                        {t.avgEntry ?? "—"} → {t.avgExit ?? "—"}
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums font-medium">
                        {t.realizedR != null ? (
                          <span
                            className={
                              t.realizedR >= 0 ? "text-profit" : "text-loss"
                            }
                          >
                            {t.realizedR > 0 ? `+${t.realizedR}R` : `${t.realizedR}R`}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`py-2.5 px-2.5 text-right font-bold tabular-nums ${
                          t.netPnl >= 0 ? "text-profit" : "text-loss"
                        }`}
                      >
                        {fmtCurrency(t.netPnl)}
                      </td>
                      <td className="py-2.5 px-2.5 text-muted-foreground max-w-[260px] truncate">
                        {(t as any).partialsBreakdown || t.notes || "—"}
                      </td>
                      <td className="py-2.5 px-2.5 text-right">
                        <Link
                          href={`/trades/${t.key}`}
                          className="inline-flex items-center gap-1 rounded-md bg-secondary text-foreground border border-border font-medium/10 hover:bg-secondary text-foreground border border-border font-medium/20 border border-indigo-500/30 px-2.5 py-1 text-[11px] font-semibold text-foreground transition"
                        >
                          <span>Replay</span>
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-slate-200 dark:border-border/40 rounded-lg">
            No trades executed during this period. You can still record your market observations and HTF narrative above.
          </div>
        )}
      </div>
    </div>
  );
}

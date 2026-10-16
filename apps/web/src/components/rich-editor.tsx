"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  useCallback,
} from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link as LinkIcon,
  RemoveFormatting,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  CheckSquare,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  Image as ImageIcon,
  SeparatorHorizontal,
  Sparkles,
  Highlighter,
  Type,
  Code,
  Quote,
  Columns2,
  Columns3,
  Bookmark,
  Sigma,
  Table as TableIcon,
  Trash2,
  FolderPlus,
  X,
} from "lucide-react";
import {
  NOTION_TEXT_COLORS,
  NOTION_BG_COLORS,
  NOTION_CODE_LANGUAGES,
  type NotionColor,
} from "@/lib/notion-blocks";

export interface RichEditorHandle {
  focus: () => void;
  insertText?: (text: string) => void;
  insertHtml?: (html: string) => void;
}

export interface RichEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number | string;
  editorRef?: React.Ref<RichEditorHandle>;
  readOnly?: boolean;
  ownerType?: string;
  ownerId?: string;
  [key: string]: any;
}

const CALLOUT_ICONS = ["💡", "🎯", "⚠️", "🔥", "✅", "❌", "📌", "📈", "🧠", "📝", "🛡️", "⚡"];

const EDITOR_CSS = `
.tz-rich-content {
  outline: none;
  line-height: 1.65;
  color: #f1f5f9;
  word-break: break-word;
}
.tz-rich-content:empty:before {
  content: attr(data-placeholder);
  color: #64748b;
  pointer-events: none;
  display: block;
}
.tz-rich-content h1,
.tz-toggle-h1 > .tz-toggle-header > .tz-toggle-title {
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0.65rem 0 0.3rem;
  color: #ffffff;
}
.tz-rich-content h2,
.tz-toggle-h2 > .tz-toggle-header > .tz-toggle-title {
  font-size: 1.28rem;
  font-weight: 700;
  line-height: 1.35;
  margin: 0.55rem 0 0.25rem;
  color: #ffffff;
}
.tz-rich-content h3,
.tz-toggle-h3 > .tz-toggle-header > .tz-toggle-title {
  font-size: 1.08rem;
  font-weight: 700;
  line-height: 1.4;
  margin: 0.45rem 0 0.2rem;
  color: #ffffff;
}
.tz-rich-content p {
  margin: 0.25rem 0;
}
.tz-rich-content ul {
  list-style-type: disc;
  padding-left: 1.5rem;
  margin: 0.35rem 0;
}
.tz-rich-content ol {
  list-style-type: decimal;
  padding-left: 1.5rem;
  margin: 0.35rem 0;
}
/* Notion Quote Block */
.tz-rich-content blockquote,
.tz-quote {
  border-left: 3px solid #6366f1;
  padding: 0.35rem 0.9rem;
  margin: 0.55rem 0;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 0 0.375rem 0.375rem 0;
}
/* Inline Code & Code Block */
.tz-inline-code,
.tz-rich-content code:not(pre code) {
  background: rgba(99, 102, 241, 0.16);
  color: #fda4af;
  padding: 0.12rem 0.38rem;
  border-radius: 0.25rem;
  font-family: monospace;
  font-size: 0.85em;
}
.tz-code-block {
  background: #141722;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.6rem;
  margin: 0.65rem 0;
  overflow: hidden;
}
.tz-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  padding: 0.3rem 0.75rem;
  font-size: 0.7rem;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tz-code-block pre,
.tz-rich-content pre {
  background: #141722;
  padding: 0.75rem;
  font-family: monospace;
  font-size: 0.82rem;
  overflow-x: auto;
  margin: 0;
  color: #e2e8f0;
}
/* Standard Toggles & Toggle Headings (H1/H2/H3) */
.tz-toggle {
  margin: 0.45rem 0;
  border-radius: 0.45rem;
  padding: 0.15rem 0.35rem;
}
.tz-toggle-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0;
}
.tz-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 0.25rem;
  color: #94a3b8;
  cursor: pointer;
  user-select: none;
  font-size: 0.85rem;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.tz-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}
.tz-toggle-title {
  flex: 1;
  min-width: 0;
  font-size: 0.95rem;
}
.tz-toggle-body {
  padding-left: 1.45rem;
  margin-top: 0.2rem;
  border-left: 1px solid rgba(255, 255, 255, 0.09);
  margin-left: 0.65rem;
}
/* Notion Columns (column_list & column) */
.tz-column-list {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  margin: 0.75rem 0;
  width: 100%;
  align-items: stretch;
}
@media (max-width: 640px) {
  .tz-column-list {
    flex-direction: column;
  }
}
.tz-column {
  flex: 1;
  min-width: 0;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.015);
  border-radius: 0.55rem;
  padding: 0.65rem 0.85rem;
}
.tz-column:focus-within {
  border-color: rgba(99, 102, 241, 0.45);
}
/* Divider */
.tz-divider {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.22);
  margin: 1rem 0;
}
/* To-Do Checklist */
.tz-check-row {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: 0.28rem 0;
  padding: 0.15rem 0.3rem;
  border-radius: 0.35rem;
}
.tz-inline-checkbox {
  width: 0.95rem;
  height: 0.95rem;
  margin-top: 0.22rem;
  accent-color: #6366f1;
  cursor: pointer;
  flex-shrink: 0;
}
.tz-check-text {
  flex: 1;
  min-width: 0;
}
/* Callout Block */
.tz-callout {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  background: rgba(59, 130, 246, 0.14);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 0.65rem;
  padding: 0.75rem 0.95rem;
  margin: 0.65rem 0;
}
.tz-callout-icon {
  font-size: 1.15rem;
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  padding: 0.1rem;
  border-radius: 0.25rem;
}
.tz-callout-icon:hover {
  background: rgba(255, 255, 255, 0.12);
}
.tz-callout-content {
  flex: 1;
  min-width: 0;
}
/* Table */
.tz-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.82rem;
}
.tz-table th,
.tz-table td {
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 0.48rem 0.7rem;
  text-align: left;
  vertical-align: top;
}
.tz-table th {
  background: #161822;
  font-weight: 600;
  color: #f8fafc;
}
/* Bookmark / Link Preview / Media / Equation / System Blocks */
.tz-bookmark {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: #141722;
  border-radius: 0.6rem;
  padding: 0.65rem 0.9rem;
  margin: 0.6rem 0;
}
.tz-bookmark-link {
  color: #818cf8;
  font-weight: 600;
  font-size: 0.82rem;
  text-decoration: underline;
  word-break: break-all;
}
.tz-bookmark-caption {
  font-size: 0.75rem;
  color: #94a3b8;
}
.tz-equation {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: #141722;
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 0.5rem;
  padding: 0.55rem 0.85rem;
  margin: 0.5rem 0;
  font-family: monospace;
}
.tz-equation-symbol {
  color: #818cf8;
  font-weight: 700;
  user-select: none;
}
.tz-figure {
  margin: 0.6rem 0;
}
.tz-block-caption {
  font-size: 0.75rem;
  color: #94a3b8;
  text-align: center;
  margin-top: 0.2rem;
}
.tz-system-block {
  border: 1px dashed rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 0.5rem;
  padding: 0.45rem 0.75rem;
  margin: 0.4rem 0;
  font-size: 0.78rem;
  color: #94a3b8;
}
/* Official Notion 10 Text Colors */
.tz-color-default { color: #f1f5f9; }
.tz-color-gray { color: #94a3b8 !important; }
.tz-color-brown { color: #d6a27e !important; }
.tz-color-orange { color: #fb923c !important; }
.tz-color-yellow { color: #facc15 !important; }
.tz-color-green { color: #34d399 !important; }
.tz-color-blue { color: #60a5fa !important; }
.tz-color-purple { color: #c084fc !important; }
.tz-color-pink { color: #f472b6 !important; }
.tz-color-red { color: #f87171 !important; }

/* Official Notion 10 Highlight / Background Colors */
.tz-color-gray_background { background-color: rgba(148, 163, 184, 0.18) !important; border-color: rgba(148, 163, 184, 0.32) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-brown_background { background-color: rgba(180, 120, 80, 0.22) !important; border-color: rgba(180, 120, 80, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-orange_background { background-color: rgba(249, 115, 22, 0.20) !important; border-color: rgba(249, 115, 22, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-yellow_background { background-color: rgba(234, 179, 8, 0.20) !important; border-color: rgba(234, 179, 8, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-green_background { background-color: rgba(16, 185, 129, 0.20) !important; border-color: rgba(16, 185, 129, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-blue_background { background-color: rgba(59, 130, 246, 0.20) !important; border-color: rgba(59, 130, 246, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-purple_background { background-color: rgba(168, 85, 247, 0.20) !important; border-color: rgba(168, 85, 247, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-pink_background { background-color: rgba(236, 72, 153, 0.20) !important; border-color: rgba(236, 72, 153, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
.tz-color-red_background { background-color: rgba(239, 68, 68, 0.20) !important; border-color: rgba(239, 68, 68, 0.36) !important; padding: 0.08rem 0.25rem; border-radius: 0.25rem; }
`;

const FONT_FAMILIES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "JetBrains Mono", value: "monospace" },
];

const PREP_GAMEPLAN_TEMPLATE_HTML = `
<div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title">🎯 Preparation &amp; Game plan</div>
  </div>
  <div class="tz-toggle-body">
    <div class="tz-column-list" data-notion-type="column_list" data-columns="2">
      <div class="tz-column" data-notion-type="column">
        <div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="true">
          <div class="tz-toggle-header">
            <span class="tz-toggle-btn" contenteditable="false">▾</span>
            <div class="tz-toggle-title"><u><strong>Watchlist &amp; Bias</strong></u></div>
          </div>
          <div class="tz-toggle-body">
            <p><em>List of symbols &amp; HTF draw on liquidity</em></p>
          </div>
        </div>
        <div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false">
          <div class="tz-toggle-header">
            <span class="tz-toggle-btn" contenteditable="false">▸</span>
            <div class="tz-toggle-title"><strong>Economic events</strong></div>
          </div>
          <div class="tz-toggle-body" style="display:none"><p>High-impact news drivers...</p></div>
        </div>
      </div>
      <div class="tz-column" data-notion-type="column">
        <div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="true">
          <div class="tz-toggle-header">
            <span class="tz-toggle-btn" contenteditable="false">▾</span>
            <div class="tz-toggle-title"><u><strong>Key Levels &amp; Gameplan</strong></u></div>
          </div>
          <div class="tz-toggle-body">
            <p><em>Session highs/lows, FVGs, and execution triggers</em></p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<hr class="tz-divider" data-notion-type="divider" />
<div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title">📝 Session log</div>
  </div>
  <div class="tz-toggle-body">
    <p>Paste TradingView screenshots (Ctrl+V) or log live execution notes here...</p>
  </div>
</div>
<p><br/></p>
`;

const POST_TRADE_TEMPLATE_HTML = `
<div class="tz-callout tz-color-blue_background" data-notion-type="callout" data-notion-color="blue_background" data-icon="🎯">
  <span class="tz-callout-icon" contenteditable="false">🎯</span>
  <div class="tz-callout-content">
    <div><strong>Core Trade Thesis &amp; Grade</strong></div>
    <div>Summarize why this setup qualified under your Playbook rules.</div>
  </div>
</div>
<div class="tz-column-list" data-notion-type="column_list" data-columns="2">
  <div class="tz-column" data-notion-type="column">
    <h3>✅ What Went Well</h3>
    <div class="tz-check-row" data-notion-type="to_do">
      <input type="checkbox" class="tz-inline-checkbox" checked="checked" />
      <div class="tz-check-text">Followed HTF bias &amp; key level</div>
    </div>
  </div>
  <div class="tz-column" data-notion-type="column">
    <h3>⚠️ Areas to Improve</h3>
    <div class="tz-check-row" data-notion-type="to_do">
      <input type="checkbox" class="tz-inline-checkbox" />
      <div class="tz-check-text">Review stop placement / scaling</div>
    </div>
  </div>
</div>
<p><br/></p>
`;

interface SavedTemplate {
  id: string;
  name: string;
  html: string;
}

const DEFAULT_TEMPLATES: SavedTemplate[] = [
  {
    id: "tpl-prep",
    name: "🎯 Preparation & Session Log",
    html: PREP_GAMEPLAN_TEMPLATE_HTML,
  },
  {
    id: "tpl-review",
    name: "🔍 Post-Trade Review (2-Col)",
    html: POST_TRADE_TEMPLATE_HTML,
  },
];

function repairCorruptedHtml(input: string): string {
  if (!input) return "";
  let s = input;
  for (let pass = 0; pass < 3; pass++) {
    if (
      !s.includes("&lt;p&gt;") &&
      !s.includes("&lt;a ") &&
      !s.includes("&lt;div") &&
      !s.includes("&lt;br") &&
      !s.includes("&lt;/")
    ) {
      break;
    }
    s = s.replace(/<a\s+[^>]*>(https?:\/\/[^<]+)<\/a>/gi, "$1");
    s = s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  s = s.replace(
    /<a\s+href="[^"]*?(https?:\/\/[^"\s<>]+)[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">$1</a>'
  );
  s = s.replace(/"=""\s*target="_blank"\s*rel="noopener noreferrer"\s*class="text-indigo-400 underline">/gi, "");
  s = s.replace(/<p>\s*<p>/gi, "<p>").replace(/<\/p>\s*<\/p>/gi, "</p>");
  return s;
}

function normalizeIncomingValue(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const healed = repairCorruptedHtml(raw);
  const trimmed = healed.trim();
  if (
    /<(p|div|h1|h2|h3|ul|ol|li|details|hr|img|figure|span|strong|em|u|br|blockquote|pre|table)\b/i.test(
      trimmed
    )
  ) {
    return healed;
  }
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">$1</a>'
  );
  return withLinks
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function RichEditor({
  value,
  onChange,
  placeholder = "Type '/' for Notion blocks (toggles, columns, callouts, images) or paste screenshots (Ctrl+V)...",
  className = "",
  minHeight = 260,
  editorRef,
  readOnly = false,
  ownerType = "editor",
  ownerId = "inline-note",
}: RichEditorProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastEmittedRef = useRef<string>(value);
  const activeBlockRef = useRef<HTMLElement | null>(null);

  const [blockType, setBlockType] = useState<string>("Normal");
  const [fontFamily, setFontFamily] = useState<string>("Arial");
  const [fontSize, setFontSize] = useState<number>(15);
  const [fullscreen, setFullscreen] = useState<boolean>(false);

  const [openPopover, setOpenPopover] = useState<
    null | "block" | "font" | "color" | "align" | "insert"
  >(null);

  const [slashMenu, setSlashMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    filter: string;
  }>({ open: false, x: 0, y: 0, filter: "" });

  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);

  const [lightbox, setLightbox] = useState<{
    open: boolean;
    images: string[];
    currentIndex: number;
  }>({ open: false, images: [], currentIndex: 0 });

  const openLightboxForImage = (clickedSrc: string) => {
    if (!contentRef.current) return;
    const imgs = Array.from(contentRef.current.querySelectorAll("img")).map((img) => img.src);
    const index = Math.max(0, imgs.indexOf(clickedSrc));
    setLightbox({ open: true, images: imgs, currentIndex: index });
  };

  useEffect(() => {
    if (!lightbox.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightbox((s) => ({ ...s, open: false }));
      } else if (e.key === "ArrowRight") {
        setLightbox((s) => ({
          ...s,
          currentIndex: (s.currentIndex + 1) % s.images.length,
        }));
      } else if (e.key === "ArrowLeft") {
        setLightbox((s) => ({
          ...s,
          currentIndex: (s.currentIndex - 1 + s.images.length) % s.images.length,
        }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox.open, lightbox.images.length]);

  const [templates, setTemplates] = useState<SavedTemplate[]>(DEFAULT_TEMPLATES);
  const [newTemplateModal, setNewTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tz_custom_note_templates");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setTemplates([...DEFAULT_TEMPLATES, ...parsed]);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (value !== lastEmittedRef.current) {
      const normalized = normalizeIncomingValue(value);
      if (el.innerHTML !== normalized) {
        el.innerHTML = normalized;
      }
      lastEmittedRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const normalized = normalizeIncomingValue(value);
    if (el.innerHTML !== normalized) {
      el.innerHTML = normalized;
    }
  }, []);

  const emitChange = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmittedRef.current = html;
    onChange(html);
  }, [onChange]);

  const insertHtmlAtCursor = useCallback(
    (html: string) => {
      const el = contentRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        document.execCommand("insertHTML", false, html);
      } else {
        el.insertAdjacentHTML("beforeend", html);
      }
      emitChange();
    },
    [emitChange]
  );

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => contentRef.current?.focus(),
      insertText: (text: string) => insertHtmlAtCursor(text),
      insertHtml: (html: string) => insertHtmlAtCursor(html),
    }),
    [insertHtmlAtCursor]
  );

  const exec = (command: string, arg?: string) => {
    contentRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  };

  // Insert Standard Toggle OR Toggle Heading (H1 / H2 / H3)
  const insertToggleBlock = (
    toggleKind: "toggle" | "heading_1" | "heading_2" | "heading_3" = "toggle",
    defaultTitle?: string,
    defaultBody = "Type inside toggle..."
  ) => {
    const levelClass =
      toggleKind === "heading_1"
        ? " tz-toggle-h1"
        : toggleKind === "heading_2"
        ? " tz-toggle-h2"
        : toggleKind === "heading_3"
        ? " tz-toggle-h3"
        : "";
    const title =
      defaultTitle ??
      (toggleKind === "heading_1"
        ? "Toggle Heading 1"
        : toggleKind === "heading_2"
        ? "Toggle Heading 2"
        : toggleKind === "heading_3"
        ? "Toggle Heading 3"
        : "Toggle header");

    const toggleHtml = `
      <div class="tz-toggle${levelClass}" data-notion-type="${toggleKind}" data-toggle-type="${toggleKind}" data-open="true">
        <div class="tz-toggle-header">
          <span class="tz-toggle-btn" contenteditable="false">▾</span>
          <div class="tz-toggle-title"><strong>${title}</strong></div>
        </div>
        <div class="tz-toggle-body">
          <p>${defaultBody}</p>
        </div>
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(toggleHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  // Insert Notion Multi-Column Block (`column_list` > `column`)
  const insertColumnsBlock = (colCount: 2 | 3 = 2) => {
    const colsHtml = Array.from({ length: colCount })
      .map(
        (_, i) => `
        <div class="tz-column" data-notion-type="column">
          <p><strong>Column ${i + 1}</strong></p>
          <p>Add text, toggles, or paste screenshots...</p>
        </div>`
      )
      .join("");

    const html = `
      <div class="tz-column-list" data-notion-type="column_list" data-columns="${colCount}">
        ${colsHtml}
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(html);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const applyBlockType = (tag: string, label: string) => {
    if (tag === "toggle_h1") return insertToggleBlock("heading_1");
    if (tag === "toggle_h2") return insertToggleBlock("heading_2");
    if (tag === "toggle_h3") return insertToggleBlock("heading_3");
    if (tag === "toggle") return insertToggleBlock("toggle");

    contentRef.current?.focus();
    document.execCommand("formatBlock", false, `<${tag.toUpperCase()}>`);
    setBlockType(label);
    setOpenPopover(null);
    emitChange();
  };

  const applyFontFamily = (label: string, cssValue: string) => {
    contentRef.current?.focus();
    document.execCommand("fontName", false, cssValue);
    setFontFamily(label);
    setOpenPopover(null);
    emitChange();
  };

  const applyFontSize = (nextSize: number) => {
    const clamped = Math.max(10, Math.min(48, nextSize));
    setFontSize(clamped);
    const el = contentRef.current;
    if (!el) return;
    el.focus();

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)) {
      const span = document.createElement("span");
      span.style.fontSize = `${clamped}px`;
      try {
        const range = sel.getRangeAt(0);
        range.surroundContents(span);
        emitChange();
        return;
      } catch {
        // fallback
      }
    }
    el.style.fontSize = `${clamped}px`;
    emitChange();
  };

  // Apply Notion Inline Color or Block-Level Background Color
  const applyNotionColor = (
    notionColorId: NotionColor,
    hexOrRgba: string,
    mode: "inline-text" | "inline-bg" | "block-bg"
  ) => {
    const el = contentRef.current;
    if (!el) return;
    el.focus();

    if (mode === "block-bg") {
      const targetBlock =
        activeBlockRef.current?.closest(
          ".tz-callout, .tz-toggle, .tz-quote, blockquote, .tz-column, p, h1, h2, h3"
        ) as HTMLElement | null;

      if (targetBlock) {
        // Strip previous tz-color-* classes
        targetBlock.className = targetBlock.className
          .replace(/\btz-color-[a-z_]+\b/g, "")
          .trim();
        if (notionColorId !== "default") {
          targetBlock.classList.add(`tz-color-${notionColorId}`);
          targetBlock.setAttribute("data-notion-color", notionColorId);
        } else {
          targetBlock.removeAttribute("data-notion-color");
        }
        emitChange();
      }
      setOpenPopover(null);
      return;
    }

    if (mode === "inline-text") {
      document.execCommand("foreColor", false, hexOrRgba);
    } else {
      document.execCommand("hiliteColor", false, hexOrRgba);
    }
    setOpenPopover(null);
    emitChange();
  };

  const toggleInlineCode = () => {
    const el = contentRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)) {
      const text = sel.toString();
      document.execCommand(
        "insertHTML",
        false,
        `<code class="tz-inline-code">${text}</code>`
      );
      emitChange();
    }
  };

  const insertChecklistItem = () => {
    const checkHtml = `
      <div class="tz-check-row" data-notion-type="to_do">
        <input type="checkbox" class="tz-inline-checkbox" />
        <div class="tz-check-text">To-do item</div>
      </div>
    `;
    insertHtmlAtCursor(checkHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertCallout = (
    icon = "💡",
    bgColor: NotionColor = "blue_background"
  ) => {
    const calloutHtml = `
      <div class="tz-callout tz-color-${bgColor}" data-notion-type="callout" data-notion-color="${bgColor}" data-icon="${icon}">
        <span class="tz-callout-icon" contenteditable="false" title="Click to change icon">${icon}</span>
        <div class="tz-callout-content"><div>Key trading note or reminder...</div></div>
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(calloutHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertQuoteBlock = () => {
    const quoteHtml = `
      <blockquote class="tz-quote" data-notion-type="quote">
        <div>Quote or key market observation...</div>
      </blockquote>
      <p><br/></p>
    `;
    insertHtmlAtCursor(quoteHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertCodeBlock = (lang = "plain text") => {
    const codeHtml = `
      <div class="tz-code-block" data-notion-type="code" data-language="${lang}">
        <div class="tz-code-header" contenteditable="false">
          <span class="tz-code-lang" title="Click to switch language">${lang}</span>
        </div>
        <pre><code>// Type or paste code here...</code></pre>
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(codeHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertDivider = () => {
    insertHtmlAtCursor(`<hr class="tz-divider" data-notion-type="divider" /><p><br/></p>`);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertTable = () => {
    const tableHtml = `
      <table class="tz-table" data-notion-type="table">
        <tbody>
          <tr><th>Metric / Setup</th><th>Observation</th><th>Result</th></tr>
          <tr><td>Entry Criteria</td><td></td><td></td></tr>
          <tr><td>Execution</td><td></td><td></td></tr>
        </tbody>
      </table>
      <p><br/></p>
    `;
    insertHtmlAtCursor(tableHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertBookmarkBlock = () => {
    const url = window.prompt("Enter Bookmark or TradingView Link URL:", "https://");
    if (!url) return;
    const html = `
      <div class="tz-bookmark" data-notion-type="bookmark" data-url="${url}">
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="tz-bookmark-link" contenteditable="false">
          🔗 ${url}
        </a>
        <div class="tz-bookmark-caption">Bookmark description or chart note</div>
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(html);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertEquationBlock = () => {
    const expr = window.prompt(
      "Enter Math / Expectancy Formula (LaTeX or plain formula):",
      "E = (W% × AvgWin) - (L% × AvgLoss)"
    );
    if (!expr) return;
    const html = `
      <div class="tz-equation" data-notion-type="equation" data-expression="${expr}">
        <span class="tz-equation-symbol" contenteditable="false">∑</span>
        <code class="tz-equation-code">${expr}</code>
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(html);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const compressImageToWebp = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const maxDim = 1920;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve(file);
            const baseName = (file.name || "screenshot").replace(/\.[^.]+$/, "");
            resolve(new File([blob], `${baseName}.webp`, { type: "image/webp" }));
          },
          "image/webp",
          0.85
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };
      img.src = objectUrl;
    });
  };

  const insertImageFile = async (file: File) => {
    const optimizedFile = await compressImageToWebp(file);
    try {
      const form = new FormData();
      form.append("type", ownerType || "editor");
      form.append("id", ownerId || "inline-note");
      form.append("file", optimizedFile);
      const res = await fetch("/api/attachments", { method: "POST", body: form });
      if (res.ok) {
        const json = await res.json();
        const attId = json.data?.id ?? json.id;
        if (attId) {
          const imgHtml = `
            <figure class="tz-figure" data-notion-type="image" data-attachment-id="${attId}">
              <img src="/api/attachments/${attId}" alt="${optimizedFile.name}" class="tz-editor-img" style="max-width: 100%; width: 100%; border-radius: 8px; margin: 6px 0;" />
            </figure>
            <p><br/></p>
          `;
          insertHtmlAtCursor(imgHtml);
          return;
        }
      }
    } catch {
      // Fallback to data URL if offline
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        const imgHtml = `
          <figure class="tz-figure" data-notion-type="image">
            <img src="${reader.result}" alt="${file.name || "Screenshot"}" class="tz-editor-img" style="max-width: 100%; width: 100%; border-radius: 8px; margin: 6px 0;" />
          </figure>
          <p><br/></p>
        `;
        insertHtmlAtCursor(imgHtml);
      }
    };
    reader.readAsDataURL(optimizedFile);
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    activeBlockRef.current = target;

    // 1. Expand / Collapse any Toggle or Toggle Heading
    if (target.classList.contains("tz-toggle-btn")) {
      e.preventDefault();
      e.stopPropagation();
      const toggleEl = target.closest(".tz-toggle") as HTMLElement | null;
      if (toggleEl) {
        const isOpen = toggleEl.getAttribute("data-open") !== "false";
        const bodyEl = toggleEl.querySelector(
          ":scope > .tz-toggle-body"
        ) as HTMLElement | null;
        if (isOpen) {
          toggleEl.setAttribute("data-open", "false");
          target.textContent = "▸";
          if (bodyEl) bodyEl.style.display = "none";
        } else {
          toggleEl.setAttribute("data-open", "true");
          target.textContent = "▾";
          if (bodyEl) bodyEl.style.display = "block";
        }
        emitChange();
      }
      return;
    }

    // 2. Interactive Callout Icon switcher
    if (target.classList.contains("tz-callout-icon") && !readOnly) {
      e.preventDefault();
      e.stopPropagation();
      const calloutEl = target.closest(".tz-callout") as HTMLElement | null;
      if (calloutEl) {
        const current = target.textContent?.trim() || "💡";
        const idx = CALLOUT_ICONS.indexOf(current);
        const nextIcon = CALLOUT_ICONS[(idx + 1) % CALLOUT_ICONS.length]!;
        target.textContent = nextIcon;
        calloutEl.setAttribute("data-icon", nextIcon);
        emitChange();
      }
      return;
    }

    // 3. Code Block Language switcher
    if (target.classList.contains("tz-code-lang") && !readOnly) {
      e.preventDefault();
      e.stopPropagation();
      const codeBlock = target.closest(".tz-code-block") as HTMLElement | null;
      if (codeBlock) {
        const current = target.textContent?.trim() || "plain text";
        const idx = NOTION_CODE_LANGUAGES.indexOf(current);
        const nextLang =
          NOTION_CODE_LANGUAGES[(idx + 1) % NOTION_CODE_LANGUAGES.length]!;
        target.textContent = nextLang;
        codeBlock.setAttribute("data-language", nextLang);
        emitChange();
      }
      return;
    }

    // 4. To-Do Checkbox state persistence
    if (
      target.tagName === "INPUT" &&
      (target as HTMLInputElement).type === "checkbox"
    ) {
      const input = target as HTMLInputElement;
      if (input.checked) input.setAttribute("checked", "checked");
      else input.removeAttribute("checked");
      emitChange();
      return;
    }

    // 5. Image selection for resize / caption bar
    if (target.tagName === "IMG") {
      setSelectedImg(target as HTMLImageElement);
    } else {
      setSelectedImg(null);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) insertImageFile(file);
          return;
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (imageFiles.length > 0) {
        e.preventDefault();
        imageFiles.forEach(insertImageFile);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setSlashMenu((s) => ({ ...s, open: false }));
      setOpenPopover(null);
      return;
    }

    const sel = window.getSelection();
    const anchorNode = sel?.anchorNode;
    const anchorEl =
      anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as HTMLElement)
        : anchorNode?.parentElement;

    if (anchorEl) {
      activeBlockRef.current = anchorEl;
    }

    // Pressing Enter inside a Toggle title jumps into its body
    if (e.key === "Enter" && !e.shiftKey && anchorEl) {
      const titleEl = anchorEl.closest(".tz-toggle-title");
      if (titleEl) {
        e.preventDefault();
        const toggleEl = titleEl.closest(".tz-toggle") as HTMLElement | null;
        if (toggleEl) {
          toggleEl.setAttribute("data-open", "true");
          const btn = toggleEl.querySelector(
            ":scope > .tz-toggle-header > .tz-toggle-btn"
          );
          if (btn) btn.textContent = "▾";
          const bodyEl = toggleEl.querySelector(
            ":scope > .tz-toggle-body"
          ) as HTMLElement | null;
          if (bodyEl) {
            bodyEl.style.display = "block";
            const p = document.createElement("p");
            p.innerHTML = "<br/>";
            bodyEl.prepend(p);
            const range = document.createRange();
            range.setStart(p, 0);
            range.collapse(true);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
          emitChange();
        }
        return;
      }
    }

    // Slash (`/`) Command Menu
    if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = contentRef.current?.getBoundingClientRect();
        if (containerRect) {
          setSlashMenu({
            open: true,
            x: Math.max(16, rect.left - containerRect.left),
            y: Math.max(40, rect.bottom - containerRect.top + 8),
            filter: "",
          });
        }
      }
    } else if (slashMenu.open) {
      if (e.key === "Backspace") {
        setSlashMenu((s) => ({ ...s, open: false }));
      } else if (e.key.length === 1) {
        setSlashMenu((s) => ({ ...s, filter: s.filter + e.key.toLowerCase() }));
      }
    }
  };

  const handleSaveCustomTemplate = () => {
    const name = newTemplateName.trim();
    if (!name || !contentRef.current) return;
    const newTpl: SavedTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      html: contentRef.current.innerHTML,
    };
    const customOnly = [
      ...templates.filter(
        (t) => !t.id.startsWith("tpl-prep") && !t.id.startsWith("tpl-review")
      ),
      newTpl,
    ];
    localStorage.setItem("tz_custom_note_templates", JSON.stringify(customOnly));
    setTemplates([...DEFAULT_TEMPLATES, ...customOnly]);
    setNewTemplateName("");
    setNewTemplateModal(false);
  };

  const handleDeleteTemplate = (id: string) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    const customOnly = next.filter(
      (t) => !t.id.startsWith("tpl-prep") && !t.id.startsWith("tpl-review")
    );
    localStorage.setItem("tz_custom_note_templates", JSON.stringify(customOnly));
  };

  const slashItems = [
    {
      label: "Toggle list",
      desc: "Standard Notion collapsible toggle",
      action: () => insertToggleBlock("toggle"),
    },
    {
      label: "Toggle Heading 1",
      desc: "Large H1 collapsible toggle section",
      action: () => insertToggleBlock("heading_1"),
    },
    {
      label: "Toggle Heading 2",
      desc: "Medium H2 collapsible toggle section",
      action: () => insertToggleBlock("heading_2"),
    },
    {
      label: "Toggle Heading 3",
      desc: "Small H3 collapsible toggle section",
      action: () => insertToggleBlock("heading_3"),
    },
    {
      label: "2 Columns",
      desc: "Side-by-side 2-column Notion layout",
      action: () => insertColumnsBlock(2),
    },
    {
      label: "3 Columns",
      desc: "Side-by-side 3-column Notion layout",
      action: () => insertColumnsBlock(3),
    },
    {
      label: "Callout box",
      desc: "Highlighted Notion callout with clickable icon",
      action: () => insertCallout("💡", "blue_background"),
    },
    {
      label: "Quote block",
      desc: "Notion blockquote container",
      action: insertQuoteBlock,
    },
    {
      label: "Divider",
      desc: "Horizontal section separator",
      action: insertDivider,
    },
    {
      label: "To-do / Checklist",
      desc: "Interactive checkbox row",
      action: insertChecklistItem,
    },
    {
      label: "Heading 1",
      desc: "Large section heading",
      action: () => {
        applyBlockType("h1", "H1");
        setSlashMenu((s) => ({ ...s, open: false }));
      },
    },
    {
      label: "Heading 2",
      desc: "Medium section heading",
      action: () => {
        applyBlockType("h2", "H2");
        setSlashMenu((s) => ({ ...s, open: false }));
      },
    },
    {
      label: "Heading 3",
      desc: "Small section heading",
      action: () => {
        applyBlockType("h3", "H3");
        setSlashMenu((s) => ({ ...s, open: false }));
      },
    },
    {
      label: "Code block",
      desc: "Syntax block with language header",
      action: () => insertCodeBlock("plain text"),
    },
    {
      label: "Image / Screenshot",
      desc: "Auto-compressed WebP chart upload",
      action: () => {
        setSlashMenu((s) => ({ ...s, open: false }));
        fileInputRef.current?.click();
      },
    },
    {
      label: "Table",
      desc: "Structured Notion table",
      action: insertTable,
    },
    {
      label: "Web Bookmark",
      desc: "Notion bookmark card with link & caption",
      action: insertBookmarkBlock,
    },
    {
      label: "Equation / Formula",
      desc: "Math or trading expectancy formula block",
      action: insertEquationBlock,
    },
    {
      label: "Preparation & Game plan template",
      desc: "Full pre-market checklist & 2-column toggles",
      action: () => {
        insertHtmlAtCursor(PREP_GAMEPLAN_TEMPLATE_HTML);
        setSlashMenu((s) => ({ ...s, open: false }));
      },
    },
  ].filter(
    (item) =>
      !slashMenu.filter ||
      item.label.toLowerCase().includes(slashMenu.filter) ||
      item.desc.toLowerCase().includes(slashMenu.filter)
  );

  return (
    <div
      className={`${
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-[#0b0d12] p-6 overflow-y-auto"
          : "relative"
      } ${className}`}
    >
      <style dangerouslySetInnerHTML={{ __html: EDITOR_CSS }} />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) insertImageFile(file);
          e.target.value = "";
        }}
      />

      {/* RECENTLY USED TEMPLATES BAR */}
      {!readOnly && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">
              Recently used templates
            </span>
            {templates.slice(0, 3).map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => insertHtmlAtCursor(tpl.html)}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-[#161822] px-2.5 py-1 text-[11px] font-medium text-foreground/90 hover:border-indigo-500/60 hover:text-indigo-300 transition-colors"
              >
                <span>{tpl.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setNewTemplateModal(true)}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-transparent px-2.5 py-1 text-[11px] font-medium text-indigo-400 hover:bg-indigo-500/10 transition-colors"
            >
              <Plus className="h-3 w-3" />
              <span>Add template</span>
            </button>
          </div>
        </div>
      )}

      {/* MAIN EDITOR CONTAINER */}
      <div className="flex-1 rounded-xl border border-border/60 bg-[#0d0f14] shadow-inner overflow-visible">
        {/* TOP TOOLBAR */}
        {!readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/50 bg-[#12141c] px-2.5 py-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              {/* 1. Block / Heading / Toggle Heading Selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "block" ? null : "block")
                  }
                  className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-[#181b26] px-2 text-[11px] font-semibold text-foreground hover:border-border"
                >
                  <span>{blockType}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>

                {openPopover === "block" && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-border/80 bg-[#161822] p-1 shadow-2xl space-y-0.5">
                    {[
                      { tag: "p", code: "Normal", label: "Normal text" },
                      { tag: "h1", code: "H1", label: "Heading 1" },
                      { tag: "h2", code: "H2", label: "Heading 2" },
                      { tag: "h3", code: "H3", label: "Heading 3" },
                      { tag: "toggle_h1", code: "▸ H1", label: "Toggle Heading 1" },
                      { tag: "toggle_h2", code: "▸ H2", label: "Toggle Heading 2" },
                      { tag: "toggle_h3", code: "▸ H3", label: "Toggle Heading 3" },
                      { tag: "toggle", code: "Toggle", label: "Toggle list" },
                      { tag: "blockquote", code: "Quote", label: "Quote block" },
                    ].map((item) => (
                      <button
                        key={item.tag}
                        type="button"
                        onClick={() => applyBlockType(item.tag, item.code)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                      >
                        <span>{item.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {item.code}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Font Family Selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "font" ? null : "font")
                  }
                  className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-[#181b26] px-2.5 text-[11px] font-medium text-foreground hover:border-border"
                >
                  <Type className="h-3 w-3 text-muted-foreground" />
                  <span className="max-w-[68px] truncate">{fontFamily}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>

                {openPopover === "font" && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-border/80 bg-[#161822] p-1 shadow-2xl space-y-0.5">
                    {FONT_FAMILIES.map((f) => (
                      <button
                        key={f.label}
                        type="button"
                        onClick={() => applyFontFamily(f.label, f.value)}
                        style={{ fontFamily: f.value }}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                      >
                        <span>{f.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. Font Size Stepper */}
              <div className="flex items-center gap-0.5 px-1">
                <button
                  type="button"
                  onClick={() => applyFontSize(fontSize - 1)}
                  className="flex h-7 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  title="Decrease font size"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <input
                  type="number"
                  value={fontSize}
                  onChange={(e) => applyFontSize(Number(e.target.value) || 15)}
                  className="h-7 w-9 rounded-md border border-border/60 bg-[#181b26] text-center text-[11px] font-semibold text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={() => applyFontSize(fontSize + 1)}
                  className="flex h-7 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  title="Increase font size"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              <div className="mx-0.5 h-4 w-px bg-border/40" />

              {/* 4. Inline Annotations (B, I, U, S, Inline Code, Link, Clear) */}
              <button
                type="button"
                onClick={() => exec("bold")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Bold"
              >
                <Bold className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => exec("italic")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Italic"
              >
                <Italic className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => exec("underline")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Underline"
              >
                <Underline className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => exec("strikeThrough")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Strikethrough"
              >
                <Strikethrough className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleInlineCode}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Inline code"
              >
                <Code className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = window.prompt("Enter link URL:", "https://");
                  if (url) exec("createLink", url);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Insert link"
              >
                <LinkIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => exec("removeFormat")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Clear formatting"
              >
                <RemoveFormatting className="h-3.5 w-3.5" />
              </button>

              <div className="mx-0.5 h-4 w-px bg-border/40" />

              {/* 5. Official Notion 10 Text + 10 Highlight + Block Background Colors */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "color" ? null : "color")
                  }
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-foreground hover:bg-secondary/50"
                  title="Notion Text, Highlight & Block Colors"
                >
                  <span className="font-bold underline decoration-indigo-400 decoration-2">
                    A
                  </span>
                  <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                {openPopover === "color" && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-border/80 bg-[#161822] p-3 shadow-2xl space-y-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Notion Text Color (10)
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {NOTION_TEXT_COLORS.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              applyNotionColor(c.id, c.hex, "inline-text")
                            }
                            className="flex h-6 items-center justify-center rounded border border-white/15 text-xs font-bold hover:scale-105 transition-transform"
                            style={{ color: c.hex, background: "#0d0f14" }}
                            title={c.label}
                          >
                            A
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Text Highlight Background (10)
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {NOTION_BG_COLORS.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              applyNotionColor(c.id, c.rgba, "inline-bg")
                            }
                            className="h-6 rounded border hover:scale-105 transition-transform"
                            style={{
                              backgroundColor:
                                c.rgba === "transparent" ? "#0d0f14" : c.rgba,
                              borderColor: c.border,
                            }}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Block Background (Callout / Toggle / Quote)
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {NOTION_BG_COLORS.map((c) => (
                          <button
                            key={`block-${c.id}`}
                            type="button"
                            onClick={() =>
                              applyNotionColor(c.id, c.rgba, "block-bg")
                            }
                            className="flex h-6 items-center justify-center rounded border text-[9px] text-foreground/80 hover:scale-105 transition-transform"
                            style={{
                              backgroundColor:
                                c.rgba === "transparent" ? "#0d0f14" : c.rgba,
                              borderColor: c.border,
                            }}
                            title={`Block: ${c.label}`}
                          >
                            ▣
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mx-0.5 h-4 w-px bg-border/40" />

              {/* 6. Lists & Alignment Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "align" ? null : "align")
                  }
                  className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-[#181b26] px-2 text-foreground hover:border-border"
                  title="Lists & alignment"
                >
                  <List className="h-3.5 w-3.5" />
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>

                {openPopover === "align" && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl space-y-0.5">
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("toggle")}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-indigo-300 font-medium hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span>Toggle list</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("heading_2")}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-indigo-300 font-medium hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span>Toggle Heading (H2)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        exec("insertUnorderedList");
                        setOpenPopover(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                    >
                      <List className="h-3.5 w-3.5" />
                      <span>Bullet list</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        exec("insertOrderedList");
                        setOpenPopover(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ListOrdered className="h-3.5 w-3.5" />
                      <span>Numbered list</span>
                    </button>
                    <button
                      type="button"
                      onClick={insertChecklistItem}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      <span>To-do checklist</span>
                    </button>
                    <div className="my-1 border-t border-border/30" />
                    <div className="flex items-center justify-around py-1">
                      <button
                        type="button"
                        onClick={() => {
                          exec("justifyLeft");
                          setOpenPopover(null);
                        }}
                        className="rounded p-1.5 hover:bg-secondary/50"
                        title="Align Left"
                      >
                        <AlignLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          exec("justifyCenter");
                          setOpenPopover(null);
                        }}
                        className="rounded p-1.5 hover:bg-secondary/50"
                        title="Align Center"
                      >
                        <AlignCenter className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          exec("justifyRight");
                          setOpenPopover(null);
                        }}
                        className="rounded p-1.5 hover:bg-secondary/50"
                        title="Align Right"
                      >
                        <AlignRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 7. Quick Buttons: Toggle, Columns, Callout, Image + Full "+" Notion Block Menu */}
              <button
                type="button"
                onClick={() => insertToggleBlock("toggle")}
                className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-[#181b26] px-2 text-[11px] font-medium text-indigo-300 hover:border-indigo-500/50"
                title="Insert collapsible toggle"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                <span>Toggle</span>
              </button>

              <button
                type="button"
                onClick={() => insertColumnsBlock(2)}
                className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-[#181b26] px-2 text-[11px] font-medium text-foreground hover:border-indigo-500/50"
                title="Insert 2-column Notion layout"
              >
                <Columns2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Cols</span>
              </button>

              <button
                type="button"
                onClick={() => insertCallout("💡", "blue_background")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Insert Callout box"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Upload image (or paste with Ctrl+V)"
              >
                <ImageIcon className="h-3.5 w-3.5 text-emerald-400" />
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "insert" ? null : "insert")
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                  title="All Notion Blocks (+)"
                >
                  <Plus className="h-4 w-4" />
                </button>

                {openPopover === "insert" && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-64 max-h-96 overflow-y-auto rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl space-y-0.5">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Toggles &amp; Headings
                    </div>
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("toggle")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Toggle list</div>
                        <div className="text-[10px] text-muted-foreground">
                          Standard collapsible toggle
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("heading_1")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Toggle Heading 1</div>
                        <div className="text-[10px] text-muted-foreground">
                          Large H1 collapsible section
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("heading_2")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Toggle Heading 2</div>
                        <div className="text-[10px] text-muted-foreground">
                          Medium H2 collapsible section
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("heading_3")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Toggle Heading 3</div>
                        <div className="text-[10px] text-muted-foreground">
                          Small H3 collapsible section
                        </div>
                      </div>
                    </button>

                    <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Columns &amp; Layout
                    </div>
                    <button
                      type="button"
                      onClick={() => insertColumnsBlock(2)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Columns2 className="h-4 w-4 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-semibold">2 Columns</div>
                        <div className="text-[10px] text-muted-foreground">
                          Two side-by-side Notion columns
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertColumnsBlock(3)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Columns3 className="h-4 w-4 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-semibold">3 Columns</div>
                        <div className="text-[10px] text-muted-foreground">
                          Three side-by-side Notion columns
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={insertDivider}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <SeparatorHorizontal className="h-4 w-4 text-amber-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Divider</div>
                        <div className="text-[10px] text-muted-foreground">
                          Horizontal separator line
                        </div>
                      </div>
                    </button>

                    <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Callouts, Quotes &amp; Media
                    </div>
                    <button
                      type="button"
                      onClick={() => insertCallout("💡", "blue_background")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Callout box</div>
                        <div className="text-[10px] text-muted-foreground">
                          Icon + Notion colored background
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={insertQuoteBlock}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Quote className="h-4 w-4 text-indigo-300 shrink-0" />
                      <div>
                        <div className="font-semibold">Quote block</div>
                        <div className="text-[10px] text-muted-foreground">
                          Left-bordered Notion quote
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertCodeBlock("plain text")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Code className="h-4 w-4 text-rose-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Code block</div>
                        <div className="text-[10px] text-muted-foreground">
                          Code block with language selector
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenPopover(null);
                        fileInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ImageIcon className="h-4 w-4 text-emerald-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Image / Screenshot</div>
                        <div className="text-[10px] text-muted-foreground">
                          Auto-compressed WebP attachment
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={insertTable}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <TableIcon className="h-4 w-4 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Table</div>
                        <div className="text-[10px] text-muted-foreground">
                          3-column structured table
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={insertBookmarkBlock}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Bookmark className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Web Bookmark</div>
                        <div className="text-[10px] text-muted-foreground">
                          TradingView or Notion link card
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={insertEquationBlock}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Sigma className="h-4 w-4 text-emerald-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Math / Equation</div>
                        <div className="text-[10px] text-muted-foreground">
                          Formula or R-multiple expression
                        </div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Controls: Undo, Redo, Fullscreen */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => exec("undo")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                title="Undo"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => exec("redo")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                title="Redo"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
              <div className="mx-0.5 h-4 w-px bg-border/40" />
              <button
                type="button"
                onClick={() => setFullscreen(!fullscreen)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* SELECTED IMAGE RESIZE & CAPTION BAR */}
        {selectedImg && !readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs">
            <span className="text-[11px] font-medium text-indigo-300">
              Image selected:
            </span>
            <div className="flex items-center gap-1.5">
              {["25%", "50%", "75%", "100%"].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => {
                    selectedImg.style.width = w;
                    emitChange();
                  }}
                  className="rounded bg-[#161822] px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-indigo-600 hover:text-white"
                >
                  {w}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const cap = window.prompt("Image caption:");
                  if (cap !== null) {
                    const fig = selectedImg.closest("figure");
                    if (fig) {
                      let fc = fig.querySelector("figcaption");
                      if (!fc) {
                        fc = document.createElement("figcaption");
                        fc.className = "tz-block-caption";
                        fig.appendChild(fc);
                      }
                      fc.textContent = cap;
                      emitChange();
                    }
                  }
                }}
                className="rounded bg-[#161822] px-2 py-0.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-600 hover:text-white"
              >
                + Caption
              </button>
              <button
                type="button"
                onClick={() => {
                  const fig = selectedImg.closest("figure");
                  if (fig) fig.remove();
                  else selectedImg.remove();
                  setSelectedImg(null);
                  emitChange();
                }}
                className="ml-1 rounded bg-rose-500/20 p-1 text-rose-400 hover:bg-rose-500/30"
                title="Delete image"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* WYSIWYG EDITABLE SURFACE */}
        <div
          ref={contentRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emitChange}
          onBlur={emitChange}
          onClick={handleEditorClick}
          onDoubleClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "IMG") {
              e.preventDefault();
              e.stopPropagation();
              openLightboxForImage((target as HTMLImageElement).src);
            }
          }}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
          style={{
            minHeight: fullscreen ? "calc(100vh - 150px)" : minHeight,
            fontSize: `${fontSize}px`,
          }}
          className="tz-rich-content p-4 text-sm overflow-y-auto"
        />

        {/* SLASH (`/`) COMMAND MENU */}
        {slashMenu.open && (
          <div
            style={{ left: slashMenu.x, top: slashMenu.y }}
            className="absolute z-50 w-68 rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl animate-in fade-in-50 zoom-in-95"
          >
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Notion Blocks</span>
              <button
                type="button"
                onClick={() => setSlashMenu((s) => ({ ...s, open: false }))}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {slashItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.action}
                  className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-secondary/60 transition-colors"
                >
                  <span className="text-xs font-semibold text-foreground">
                    {item.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {item.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      
      {/* LIGHTBOX MODAL WITH ARROW NAVIGATION & ESCAPE DISMISSAL */}
      {lightbox.open && lightbox.images.length > 0 && (
        <div
          onClick={() => setLightbox((s) => ({ ...s, open: false }))}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col items-center justify-center max-w-[95vw] max-h-[95vh]"
          >
            <img
              src={lightbox.images[lightbox.currentIndex]}
              alt={`Fullscreen ${lightbox.currentIndex + 1}`}
              className="max-w-full max-h-[88vh] object-contain rounded-lg shadow-2xl select-none"
            />
            <div className="mt-3 flex items-center gap-4 text-xs font-semibold text-white/80 bg-black/60 px-4 py-1.5 rounded-full border border-white/10">
              <button
                type="button"
                onClick={() =>
                  setLightbox((s) => ({
                    ...s,
                    currentIndex:
                      (s.currentIndex - 1 + s.images.length) % s.images.length,
                  }))
                }
                className="px-2 py-0.5 hover:text-white rounded hover:bg-white/10"
              >
                ◀ Prev (←)
              </button>
              <span>
                {lightbox.currentIndex + 1} / {lightbox.images.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setLightbox((s) => ({
                    ...s,
                    currentIndex: (s.currentIndex + 1) % s.images.length,
                  }))
                }
                className="px-2 py-0.5 hover:text-white rounded hover:bg-white/10"
              >
                Next (→) ▶
              </button>
              <span className="text-white/40">| Click outside or Esc to close</span>
            </div>
          </div>
        </div>
      )}

      {/* SAVE TEMPLATE MODAL */}
      {newTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border/80 bg-[#161822] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-indigo-400" />
                <span>Save current note as template</span>
              </h4>
              <button
                type="button"
                onClick={() => setNewTemplateModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              type="text"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="e.g., NY Session Prep, ICT PO3 Checklist..."
              autoFocus
              className="h-9 w-full rounded-lg border border-border/70 bg-[#0d0f14] px-3 text-xs text-foreground outline-none focus:border-indigo-500"
            />

            {templates.length > 2 && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Saved custom templates
                </span>
                {templates.slice(2).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded bg-[#0d0f14] px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate">{t.name}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setNewTemplateModal(false)}
                className="rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCustomTemplate}
                className="rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                Save template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export interface MarkdownProps {
  value?: string | null;
  content?: string | null;
  source?: string | null;
  text?: string | null;
  children?: React.ReactNode;
  className?: string;
}

function renderMarkdownOrHtml(raw: string): string {
  if (!raw || !raw.trim()) return "";
  raw = repairCorruptedHtml(raw);
  const trimmed = raw.trim();

  if (
    /<(p|div|h1|h2|h3|ul|ol|li|details|hr|img|figure|span|strong|em|u|br|blockquote|pre|table)\b/i.test(
      trimmed
    )
  ) {
    return raw;
  }

  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    if (/^###\s+(.+)/.test(line)) {
      out.push(`<h3>${line.replace(/^###\s+/, "")}</h3>`);
    } else if (/^##\s+(.+)/.test(line)) {
      out.push(`<h2>${line.replace(/^##\s+/, "")}</h2>`);
    } else if (/^#\s+(.+)/.test(line)) {
      out.push(`<h1>${line.replace(/^#\s+/, "")}</h1>`);
    } else if (/^-\s+\[(x\vert{}X)\]\s+(.+)/.test(line)) {
      const txt = line.replace(/^-\s+\[(x\vert{}X)\]\s+/, "");
      out.push(
        `<div class="tz-check-row"><input type="checkbox" class="tz-inline-checkbox" checked disabled /><div class="tz-check-text">${txt}</div></div>`
      );
    } else if (/^-\s+\[\s\]\s+(.+)/.test(line)) {
      const txt = line.replace(/^-\s+\[\s\]\s+/, "");
      out.push(
        `<div class="tz-check-row"><input type="checkbox" class="tz-inline-checkbox" disabled /><div class="tz-check-text">${txt}</div></div>`
      );
    } else if (/^[-*]\s+(.+)/.test(line)) {
      out.push(`<ul><li>${line.replace(/^[-*]\s+/, "")}</li></ul>`);
    } else if (!line.trim()) {
      out.push(`<br/>`);
    } else {
      out.push(`<p>${line}</p>`);
    }
  }

  return out
    .join("")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">$1</a>'
    )
    .replace(
      /(^|[\s>])(https?:\/\/[^\s<]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">$2</a>'
    );
}

export function Markdown({
  value,
  content,
  source,
  text,
  children,
  className = "",
}: MarkdownProps) {
  const raw =
    value ??
    content ??
    source ??
    text ??
    (typeof children === "string" ? children : "");

  if (!raw || !String(raw).trim()) {
    return null;
  }

  const html = renderMarkdownOrHtml(String(raw));

  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("tz-toggle-btn")) {
      e.preventDefault();
      e.stopPropagation();
      const toggleEl = target.closest(".tz-toggle") as HTMLElement | null;
      if (toggleEl) {
        const isOpen = toggleEl.getAttribute("data-open") !== "false";
        const bodyEl = toggleEl.querySelector(
          ":scope > .tz-toggle-body"
        ) as HTMLElement | null;
        if (isOpen) {
          toggleEl.setAttribute("data-open", "false");
          target.textContent = "▸";
          if (bodyEl) bodyEl.style.display = "none";
        } else {
          toggleEl.setAttribute("data-open", "true");
          target.textContent = "▾";
          if (bodyEl) bodyEl.style.display = "block";
        }
      }
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: EDITOR_CSS }} />
      <div
        onClick={handlePreviewClick}
        className={`tz-rich-content text-sm ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

export default RichEditor;

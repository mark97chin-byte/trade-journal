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
  Trash2,
  FolderPlus,
  X,
} from "lucide-react";

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
  [key: string]: any;
}

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
.tz-rich-content h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0.75rem 0 0.35rem;
  color: #ffffff;
}
.tz-rich-content h2 {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0.65rem 0 0.3rem;
  color: #ffffff;
}
.tz-rich-content h3 {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0.5rem 0 0.25rem;
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
.tz-rich-content blockquote {
  border-left: 3px solid #6366f1;
  padding-left: 0.85rem;
  margin: 0.5rem 0;
  color: #cbd5e1;
  font-style: italic;
}
.tz-rich-content pre {
  background: #161822;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.5rem;
  padding: 0.75rem;
  font-family: monospace;
  font-size: 0.8rem;
  overflow-x: auto;
}
.tz-toggle {
  margin: 0.45rem 0;
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
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 0.25rem;
  color: #94a3b8;
  cursor: pointer;
  user-select: none;
  font-size: 0.85rem;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.tz-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}
.tz-toggle-title {
  flex: 1;
  min-width: 0;
  font-size: 0.95rem;
}
.tz-toggle-body {
  padding-left: 1.5rem;
  margin-top: 0.2rem;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  margin-left: 0.65rem;
}
.tz-divider {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.22);
  margin: 1rem 0;
}
.tz-check-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25rem 0;
}
.tz-inline-checkbox {
  width: 0.95rem;
  height: 0.95rem;
  accent-color: #6366f1;
  cursor: pointer;
}
.tz-callout {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 0.6rem;
  padding: 0.75rem 0.9rem;
  margin: 0.6rem 0;
}
.tz-callout-content {
  flex: 1;
}
.tz-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.8rem;
}
.tz-table th,
.tz-table td {
  border: 1px solid rgba(255, 255, 255, 0.14);
  padding: 0.45rem 0.65rem;
  text-align: left;
}
.tz-table th {
  background: #161822;
  font-weight: 600;
}
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

const TEXT_COLORS = [
  { label: "Default", color: "#f8fafc" },
  { label: "Muted", color: "#94a3b8" },
  { label: "Green", color: "#34d399" },
  { label: "Red", color: "#f87171" },
  { label: "Amber", color: "#fbbf24" },
  { label: "Blue", color: "#60a5fa" },
  { label: "Indigo", color: "#818cf8" },
  { label: "Purple", color: "#c084fc" },
  { label: "Pink", color: "#f472b6" },
];

const HIGHLIGHT_COLORS = [
  { label: "None", color: "transparent" },
  { label: "Green", color: "rgba(16, 185, 129, 0.25)" },
  { label: "Red", color: "rgba(239, 68, 68, 0.25)" },
  { label: "Amber", color: "rgba(245, 158, 11, 0.25)" },
  { label: "Blue", color: "rgba(59, 130, 246, 0.25)" },
  { label: "Purple", color: "rgba(139, 92, 246, 0.25)" },
  { label: "Slate", color: "rgba(148, 163, 184, 0.2)" },
];

const PREP_GAMEPLAN_TEMPLATE_HTML = `
<div class="tz-toggle" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title"><strong>🎯 Preparation &amp; Game plan</strong></div>
  </div>
  <div class="tz-toggle-body">
    <div class="tz-toggle" data-open="true">
      <div class="tz-toggle-header">
        <span class="tz-toggle-btn" contenteditable="false">▾</span>
        <div class="tz-toggle-title"><u><strong>Watchlist</strong></u></div>
      </div>
      <div class="tz-toggle-body">
        <p><em>List of symbols you plan to watch today</em></p>
      </div>
    </div>
    <div class="tz-toggle" data-open="false">
      <div class="tz-toggle-header">
        <span class="tz-toggle-btn" contenteditable="false">▸</span>
        <div class="tz-toggle-title"><strong>Economic events</strong></div>
      </div>
      <div class="tz-toggle-body" style="display:none"><p>High-impact news &amp; session timings...</p></div>
    </div>
    <div class="tz-toggle" data-open="false">
      <div class="tz-toggle-header">
        <span class="tz-toggle-btn" contenteditable="false">▸</span>
        <div class="tz-toggle-title"><strong>Daily/Weekly Bias</strong></div>
      </div>
      <div class="tz-toggle-body" style="display:none"><p>HTF draw on liquidity &amp; directional bias...</p></div>
    </div>
    <div class="tz-toggle" data-open="false">
      <div class="tz-toggle-header">
        <span class="tz-toggle-btn" contenteditable="false">▸</span>
        <div class="tz-toggle-title"><strong>Levels to Watch</strong></div>
      </div>
      <div class="tz-toggle-body" style="display:none"><p>Key session highs/lows, FVGs, and orderblocks...</p></div>
    </div>
    <div class="tz-toggle" data-open="false">
      <div class="tz-toggle-header">
        <span class="tz-toggle-btn" contenteditable="false">▸</span>
        <div class="tz-toggle-title"><u><strong>Gameplan</strong></u></div>
      </div>
      <div class="tz-toggle-body" style="display:none"><p>If/then scenarios for execution...</p></div>
    </div>
  </div>
</div>
<hr class="tz-divider" />
<div class="tz-toggle" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title"><strong>📝 Session log</strong></div>
  </div>
  <div class="tz-toggle-body">
    <p>Paste chart screenshots (Ctrl+V) or log live session observations here...</p>
  </div>
</div>
<p><br/></p>
`;

const POST_TRADE_TEMPLATE_HTML = `
<div class="tz-toggle" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title"><strong>🔍 Execution &amp; Setup Review</strong></div>
  </div>
  <div class="tz-toggle-body">
    <p><strong>Entry trigger:</strong> </p>
    <p><strong>Risk management:</strong> </p>
    <p><strong>Key takeaway:</strong> </p>
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
    name: "🔍 Post-Trade Review",
    html: POST_TRADE_TEMPLATE_HTML,
  },
];

function normalizeIncomingValue(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const trimmed = raw.trim();
  if (/<(p|div|h1|h2|h3|ul|ol|li|details|hr|img|span|strong|em|u|br|blockquote|pre|table)/i.test(trimmed)) {
    return raw;
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
  placeholder = "Type '/' for commands, add toggles, or paste screenshots (Ctrl+V)...",
  className = "",
  minHeight = 260,
  editorRef,
  readOnly = false,
}: RichEditorProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastEmittedRef = useRef<string>(value);

  const [blockType, setBlockType] = useState<string>("H3");
  const [fontFamily, setFontFamily] = useState<string>("Arial");
  const [fontSize, setFontSize] = useState<number>(16);
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

  const applyBlockType = (tag: string, label: string) => {
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

  const insertToggleBlock = (title = "Toggle header", body = "Type inside toggle...") => {
    const toggleHtml = `
      <div class="tz-toggle" data-open="true">
        <div class="tz-toggle-header">
          <span class="tz-toggle-btn" contenteditable="false">▾</span>
          <div class="tz-toggle-title"><strong>${title}</strong></div>
        </div>
        <div class="tz-toggle-body">
          <p>${body}</p>
        </div>
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(toggleHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertChecklistItem = () => {
    const checkHtml = `
      <div class="tz-check-row">
        <input type="checkbox" class="tz-inline-checkbox" />
        <span class="tz-check-text">To-do item</span>
      </div>
    `;
    insertHtmlAtCursor(checkHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertCallout = () => {
    const calloutHtml = `
      <div class="tz-callout">
        <span class="tz-callout-icon" contenteditable="false">💡</span>
        <div class="tz-callout-content">Key trading note or reminder...</div>
      </div>
      <p><br/></p>
    `;
    insertHtmlAtCursor(calloutHtml);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertDivider = () => {
    insertHtmlAtCursor(`<hr class="tz-divider" /><p><br/></p>`);
    setOpenPopover(null);
    setSlashMenu((s) => ({ ...s, open: false }));
  };

  const insertTable = () => {
    const tableHtml = `
      <table class="tz-table">
        <thead>
          <tr><th>Metric / Setup</th><th>Observation</th><th>Result</th></tr>
        </thead>
        <tbody>
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

  const insertImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        const imgHtml = `<p><img src="${reader.result}" alt="${file.name || "Screenshot"}" class="tz-editor-img" style="max-width: 100%; width: 100%; border-radius: 8px; margin: 8px 0;" /></p><p><br/></p>`;
        insertHtmlAtCursor(imgHtml);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    if (target.classList.contains("tz-toggle-btn")) {
      e.preventDefault();
      e.stopPropagation();
      const toggleEl = target.closest(".tz-toggle") as HTMLElement | null;
      if (toggleEl) {
        const isOpen = toggleEl.getAttribute("data-open") !== "false";
        const bodyEl = toggleEl.querySelector(":scope > .tz-toggle-body") as HTMLElement | null;
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

    if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
      const input = target as HTMLInputElement;
      if (input.checked) input.setAttribute("checked", "checked");
      else input.removeAttribute("checked");
      emitChange();
      return;
    }

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
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
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

    if (e.key === "Enter" && !e.shiftKey && anchorEl) {
      const titleEl = anchorEl.closest(".tz-toggle-title");
      if (titleEl) {
        e.preventDefault();
        const toggleEl = titleEl.closest(".tz-toggle") as HTMLElement | null;
        if (toggleEl) {
          toggleEl.setAttribute("data-open", "true");
          const btn = toggleEl.querySelector(":scope > .tz-toggle-header > .tz-toggle-btn");
          if (btn) btn.textContent = "▾";
          const bodyEl = toggleEl.querySelector(":scope > .tz-toggle-body") as HTMLElement | null;
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
      ...templates.filter((t) => !t.id.startsWith("tpl-prep") && !t.id.startsWith("tpl-review")),
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
      desc: "Collapsible section with nested content",
      action: () => insertToggleBlock("Toggle section", "Add details..."),
    },
    {
      label: "Preparation & Game plan template",
      desc: "Full pre-market checklist & session log toggles",
      action: () => {
        insertHtmlAtCursor(PREP_GAMEPLAN_TEMPLATE_HTML);
        setSlashMenu((s) => ({ ...s, open: false }));
      },
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
      label: "Checklist item",
      desc: "Interactive to-do checkbox",
      action: insertChecklistItem,
    },
    {
      label: "Image / Screenshot",
      desc: "Upload or paste chart image",
      action: () => {
        setSlashMenu((s) => ({ ...s, open: false }));
        fileInputRef.current?.click();
      },
    },
    {
      label: "Divider",
      desc: "Horizontal separator line",
      action: insertDivider,
    },
    {
      label: "Callout box",
      desc: "Highlighted note block",
      action: insertCallout,
    },
    {
      label: "Table",
      desc: "3-column trade observation table",
      action: insertTable,
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
        {/* TRADEZELLA / NOTION TOOLBAR */}
        {!readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/50 bg-[#12141c] px-2.5 py-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              {/* 1. Block / Heading Selector (H1, H2, H3, Normal) */}
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-xl border border-border/80 bg-[#161822] p-1 shadow-2xl space-y-0.5">
                    {[
                      { tag: "p", code: "Normal", label: "Normal text" },
                      { tag: "h1", code: "H1", label: "Heading 1" },
                      { tag: "h2", code: "H2", label: "Heading 2" },
                      { tag: "h3", code: "H3", label: "Heading 3" },
                      { tag: "blockquote", code: "Quote", label: "Quote block" },
                      { tag: "pre", code: "Code", label: "Code block" },
                    ].map((item) => (
                      <button
                        key={item.tag}
                        type="button"
                        onClick={() => applyBlockType(item.tag, item.code)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                      >
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Font Family Selector (TT Arial v) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "font" ? null : "font")
                  }
                  className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-[#181b26] px-2.5 text-[11px] font-medium text-foreground hover:border-border"
                >
                  <Type className="h-3 w-3 text-muted-foreground" />
                  <span className="max-w-[72px] truncate">{fontFamily}</span>
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

              {/* 3. Font Size Stepper (- [16] +) */}
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
                  onChange={(e) => applyFontSize(Number(e.target.value) || 16)}
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

              {/* 4. Bold / Italic / Underline / Strike */}
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

              {/* 5. Link & Clear Formatting */}
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

              {/* 6. Text Color & Highlight Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "color" ? null : "color")
                  }
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-foreground hover:bg-secondary/50"
                  title="Text & highlight color"
                >
                  <span className="font-bold underline decoration-indigo-400 decoration-2">
                    A
                  </span>
                  <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                {openPopover === "color" && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-border/80 bg-[#161822] p-3 shadow-2xl space-y-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Text Color
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {TEXT_COLORS.map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => {
                              exec("foreColor", c.color);
                              setOpenPopover(null);
                            }}
                            className="h-5 w-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Highlight Background
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => {
                              exec("hiliteColor", c.color);
                              setOpenPopover(null);
                            }}
                            className="h-5 w-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mx-0.5 h-4 w-px bg-border/40" />

              {/* 7. Alignment & Lists Dropdown */}
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl space-y-0.5">
                    <button
                      type="button"
                      onClick={() => insertToggleBlock()}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-indigo-300 font-medium hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span>Toggle list (Collapsible)</span>
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
                      <span>Checklist item</span>
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

              {/* 8. Direct Toggle & Image Quick Buttons + "+" Menu */}
              <button
                type="button"
                onClick={() => insertToggleBlock("Toggle section", "Write details here...")}
                className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-[#181b26] px-2 text-[11px] font-medium text-indigo-300 hover:border-indigo-500/50"
                title="Insert collapsible toggle"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                <span>Toggle</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                title="Upload image (or paste with Ctrl+V)"
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "insert" ? null : "insert")
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary/50"
                  title="Insert block"
                >
                  <Plus className="h-4 w-4" />
                </button>

                {openPopover === "insert" && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-60 rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl space-y-0.5">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Insert Block
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        insertToggleBlock("🎯 Section Title", "Write details here...")
                      }
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Toggle block</div>
                        <div className="text-[10px] text-muted-foreground">
                          Collapsible Notion/TradeZella toggle
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setOpenPopover(null);
                        fileInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ImageIcon className="h-4 w-4 text-emerald-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Image / Chart screenshot</div>
                        <div className="text-[10px] text-muted-foreground">
                          Upload file or paste with Ctrl+V
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={insertDivider}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <SeparatorHorizontal className="h-4 w-4 text-amber-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Horizontal divider</div>
                        <div className="text-[10px] text-muted-foreground">
                          Clean section separator line
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={insertCallout}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Callout box</div>
                        <div className="text-[10px] text-muted-foreground">
                          Highlighted trading note
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={insertTable}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Code className="h-4 w-4 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Table</div>
                        <div className="text-[10px] text-muted-foreground">
                          3-column structured table
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

        {/* IMAGE RESIZE TOOLBAR */}
        {selectedImg && !readOnly && (
          <div className="flex items-center justify-between border-b border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs">
            <span className="text-[11px] font-medium text-indigo-300">
              Image selected — resize width:
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
                  selectedImg.remove();
                  setSelectedImg(null);
                  emitChange();
                }}
                className="ml-2 rounded bg-rose-500/20 p-1 text-rose-400 hover:bg-rose-500/30"
                title="Delete image"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* WYSIWYG EDITABLE AREA */}
        <div
          ref={contentRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emitChange}
          onBlur={emitChange}
          onClick={handleEditorClick}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
          style={{
            minHeight: fullscreen ? "calc(100vh - 150px)" : minHeight,
            fontSize: `${fontSize}px`,
          }}
          className="tz-rich-content p-4 text-sm overflow-y-auto"
        />

        {/* SLASH COMMAND MENU */}
        {slashMenu.open && (
          <div
            style={{ left: slashMenu.x, top: slashMenu.y }}
            className="absolute z-50 w-64 rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl animate-in fade-in-50 zoom-in-95"
          >
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Quick Commands</span>
              <button
                type="button"
                onClick={() => setSlashMenu((s) => ({ ...s, open: false }))}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
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

export default RichEditor;

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
  const trimmed = raw.trim();

  // If it already contains HTML from the new RichEditor, return directly
  if (
    /<(p|div|h1|h2|h3|ul|ol|li|details|hr|img|span|strong|em|u|br|blockquote|pre|table)\b/i.test(
      trimmed
    )
  ) {
    return raw;
  }

  // Otherwise parse legacy Markdown syntax into HTML
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
        `<div class="tz-check-row"><input type="checkbox" class="tz-inline-checkbox" checked disabled /><span class="tz-check-text">${txt}</span></div>`
      );
    } else if (/^-\s+\[\s\]\s+(.+)/.test(line)) {
      const txt = line.replace(/^-\s+\[\s\]\s+/, "");
      out.push(
        `<div class="tz-check-row"><input type="checkbox" class="tz-inline-checkbox" disabled /><span class="tz-check-text">${txt}</span></div>`
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

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
  Copy,
  FolderPlus,
  GripVertical,
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

/* Notion Line-by-Line Block Gutter & Column Styling (Light + Dark Mode Aware) */

/* High-Contrast Legible Editor Typography (Light & Dark Mode) */
.tz-rich-content,
.tz-rich-content p,
.tz-rich-content span,
.tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.tz-rich-content li,
.tz-rich-content em,
.tz-rich-content strong {
  color: #0f172a;
}
.dark .tz-rich-content,
.dark .tz-rich-content p,
.dark .tz-rich-content span,
.dark .tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.dark .tz-rich-content li,
.dark .tz-rich-content em,
.dark .tz-rich-content strong {
  color: #f8fafc;
}

/* Toggles & Toggle Headings Text Contrast */
.tz-toggle-title {
  color: #0f172a !important;
  font-weight: 700 !important;
}
.dark .tz-toggle-title {
  color: #f8fafc !important;
}
.tz-toggle-body {
  color: #1e293b !important;
}
.dark .tz-toggle-body {
  color: #e2e8f0 !important;
}

/* Quotes */
.tz-quote,
blockquote {
  border-left: 3px solid #6366f1 !important;
  color: #334155 !important;
  font-style: italic;
  padding-left: 0.75rem;
}
.dark .tz-quote,
.dark blockquote {
  color: #cbd5e1 !important;
}

.tz-rich-content {
  position: relative;
  padding-left: 3rem !important;
  padding-right: 1rem !important;
  color: inherit;
}
.tz-rich-content p,
.tz-rich-content h1,
.tz-rich-content h2,
.tz-rich-content h3,
.tz-rich-content ul,
.tz-rich-content ol,
.tz-rich-content blockquote,
.tz-rich-content .tz-toggle,
.tz-rich-content .tz-callout,
.tz-rich-content .tz-banner,
.tz-rich-content .tz-check-row,
.tz-rich-content .tz-figure,
.tz-rich-content .tz-code-block,
.tz-rich-content .tz-notion-btn-wrapper {
  position: relative;
  min-height: 1.65em;
  margin-top: 2px;
  margin-bottom: 2px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background-color 0.1s ease;
}
.tz-block-hovered {
  background-color: rgba(0, 0, 0, 0.035);
}
.dark .tz-block-hovered {
  background-color: rgba(255, 255, 255, 0.03);
}
.tz-block-dragging {
  opacity: 0.35;
}
/* Notion Section Banner Bars */
.tz-banner {
  display: block;
  width: 100%;
  padding: 0.38rem 0.75rem;
  margin: 0.65rem 0 0.4rem;
  border-radius: 0.35rem;
  font-size: 0.84rem;
  font-weight: 700;
  color: #1e293b;
  background-color: #f1f5f9;
  border: 1px solid #cbd5e1;
}
.dark .tz-banner {
  color: #f8fafc;
  background-color: rgba(148, 163, 184, 0.16);
  border-color: rgba(148, 163, 184, 0.24);
}
.tz-banner.tz-color-brown_background {
  background-color: #fef3c7 !important;
  color: #78350f !important;
  border-color: #fde68a !important;
}
.dark .tz-banner.tz-color-brown_background {
  background-color: rgba(180, 120, 80, 0.24) !important;
  color: #fde68a !important;
  border-color: rgba(180, 120, 80, 0.38) !important;
}
.tz-banner.tz-color-gray_background {
  background-color: #e2e8f0 !important;
  color: #1e293b !important;
  border-color: #cbd5e1 !important;
}
.dark .tz-banner.tz-color-gray_background {
  background-color: rgba(100, 116, 139, 0.24) !important;
  color: #f8fafc !important;
  border-color: rgba(100, 116, 139, 0.36) !important;
}
/* Notion Column Rows */
.tz-column-list {
  display: flex;
  flex-direction: row;
  gap: 1.25rem;
  margin: 0.65rem 0;
  width: 100%;
  align-items: stretch;
}
.tz-column {
  flex: 1;
  min-width: 0;
  border: 1px dashed #cbd5e1 !important;
  background: #f8fafc !important;
  border-radius: 0.5rem;
  padding: 0.45rem 0.65rem 0.45rem 2.2rem !important;
  position: relative;
  transition: border-color 0.15s, background 0.15s;
}
.dark .tz-column {
  border: 1px dashed rgba(255, 255, 255, 0.09) !important;
  background: rgba(255, 255, 255, 0.015) !important;
}
.tz-column:hover,
.tz-column:focus-within {
  border-color: #6366f1 !important;
  background: #f1f5f9 !important;
}
.dark .tz-column:hover,
.dark .tz-column:focus-within {
  border-color: rgba(99, 102, 241, 0.45) !important;
  background: rgba(255, 255, 255, 0.025) !important;
}
/* Notion Add Ticker Button */
.tz-add-ticker-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.35rem 0;
  padding: 0.25rem 0.65rem;
  border-radius: 0.375rem;
  border: 1px solid #cbd5e1;
  background: #f1f5f9;
  color: #334155;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
}
.dark .tz-add-ticker-btn {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: #cbd5e1;
}
.tz-add-ticker-btn:hover {
  background: #e0e7ff;
  border-color: #6366f1;
  color: #4338ca;
}
.dark .tz-add-ticker-btn:hover {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.45);
  color: #ffffff;
}

/* Notion Interactive Button Block */
.tz-notion-btn-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.45rem 0;
  user-select: none;
}
.tz-notion-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.32rem 0.75rem;
  border-radius: 0.45rem;
  border: 1px solid rgba(99, 102, 241, 0.38);
  background: rgba(99, 102, 241, 0.12);
  color: #e0e7ff;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.tz-notion-action-btn:hover {
  background: rgba(99, 102, 241, 0.24);
  border-color: rgba(99, 102, 241, 0.65);
  color: #ffffff;
}
.tz-notion-btn-config {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  font-size: 0.75rem;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s, background 0.15s;
}
.tz-notion-btn-wrapper:hover .tz-notion-btn-config {
  opacity: 1;
}
.tz-notion-btn-config:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

/* Empty Quote Placeholder */
.tz-quote div:empty:before,
blockquote:empty:before {
  content: attr(data-placeholder);
  color: #94a3b8;
  pointer-events: none;
}
.dark .tz-quote div:empty:before,
.dark blockquote:empty:before {
  color: #64748b;
}


/* High-Contrast Legible Editor Typography (Light & Dark Mode) */
.tz-rich-content,
.tz-rich-content p,
.tz-rich-content span,
.tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.tz-rich-content li,
.tz-rich-content em,
.tz-rich-content strong {
  color: #0f172a;
}
.dark .tz-rich-content,
.dark .tz-rich-content p,
.dark .tz-rich-content span,
.dark .tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.dark .tz-rich-content li,
.dark .tz-rich-content em,
.dark .tz-rich-content strong {
  color: #f8fafc;
}

/* Toggles & Toggle Headings Text Contrast */
.tz-toggle-title {
  color: #0f172a !important;
  font-weight: 700 !important;
}
.dark .tz-toggle-title {
  color: #f8fafc !important;
}
.tz-toggle-body {
  color: #1e293b !important;
}
.dark .tz-toggle-body {
  color: #e2e8f0 !important;
}

/* Quotes */
.tz-quote,
blockquote {
  border-left: 3px solid #6366f1 !important;
  color: #334155 !important;
  font-style: italic;
  padding-left: 0.75rem;
}
.dark .tz-quote,
.dark blockquote {
  color: #cbd5e1 !important;
}

.tz-rich-content {
  position: relative;
  padding-left: 3rem !important;
  padding-right: 1rem !important;
}
.tz-rich-content p,
.tz-rich-content h1,
.tz-rich-content h2,
.tz-rich-content h3,
.tz-rich-content ul,
.tz-rich-content ol,
.tz-rich-content blockquote,
.tz-rich-content .tz-toggle,
.tz-rich-content .tz-callout,
.tz-rich-content .tz-banner,
.tz-rich-content .tz-check-row,
.tz-rich-content .tz-figure,
.tz-rich-content .tz-code-block,
.tz-rich-content .tz-notion-btn-wrapper {
  position: relative;
  min-height: 1.65em;
  margin-top: 2px;
  margin-bottom: 2px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background-color 0.1s ease;
}
.tz-block-hovered {
  background-color: rgba(255, 255, 255, 0.025);
}
.tz-block-dragging {
  opacity: 0.35;
}
.tz-column-list {
  display: flex;
  flex-direction: row;
  gap: 1.25rem;
  margin: 0.65rem 0;
  width: 100%;
  align-items: stretch;
}
.tz-column {
  flex: 1;
  min-width: 0;
  border: 1px dashed rgba(255, 255, 255, 0.09) !important;
  background: rgba(255, 255, 255, 0.01) !important;
  border-radius: 0.5rem;
  padding: 0.45rem 0.65rem 0.45rem 2.2rem !important;
  position: relative;
  transition: border-color 0.15s, background 0.15s;
}
.tz-column:hover,
.tz-column:focus-within {
  border-color: rgba(99, 102, 241, 0.35) !important;
  background: rgba(255, 255, 255, 0.02) !important;
}


/* High-Contrast Legible Editor Typography (Light & Dark Mode) */
.tz-rich-content,
.tz-rich-content p,
.tz-rich-content span,
.tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.tz-rich-content li,
.tz-rich-content em,
.tz-rich-content strong {
  color: #0f172a;
}
.dark .tz-rich-content,
.dark .tz-rich-content p,
.dark .tz-rich-content span,
.dark .tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.dark .tz-rich-content li,
.dark .tz-rich-content em,
.dark .tz-rich-content strong {
  color: #f8fafc;
}

/* Toggles & Toggle Headings Text Contrast */
.tz-toggle-title {
  color: #0f172a !important;
  font-weight: 700 !important;
}
.dark .tz-toggle-title {
  color: #f8fafc !important;
}
.tz-toggle-body {
  color: #1e293b !important;
}
.dark .tz-toggle-body {
  color: #e2e8f0 !important;
}

/* Quotes */
.tz-quote,
blockquote {
  border-left: 3px solid #6366f1 !important;
  color: #334155 !important;
  font-style: italic;
  padding-left: 0.75rem;
}
.dark .tz-quote,
.dark blockquote {
  color: #cbd5e1 !important;
}

.tz-rich-content {
  position: relative;
  padding-left: 2.6rem !important;
}
.tz-rich-content > *,
.tz-column > *,
.tz-toggle-body > * {
  position: relative;
  transition: background-color 0.12s ease;
  border-radius: 0.25rem;
}
.tz-block-dragging {
  opacity: 0.35;
}
/* Subtle hover outline on columns only when hovered or focused (clean like Notion) */
.tz-column {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent !important;
  background: transparent !important;
  border-radius: 0.45rem;
  padding: 0.35rem 0.65rem;
  transition: border-color 0.15s, background 0.15s;
}
.tz-column-list:hover > .tz-column,
.tz-column:focus-within {
  border-color: rgba(255, 255, 255, 0.1) !important;
  background: rgba(255, 255, 255, 0.015) !important;
}


/* High-Contrast Legible Editor Typography (Light & Dark Mode) */
.tz-rich-content,
.tz-rich-content p,
.tz-rich-content span,
.tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.tz-rich-content li,
.tz-rich-content em,
.tz-rich-content strong {
  color: #0f172a;
}
.dark .tz-rich-content,
.dark .tz-rich-content p,
.dark .tz-rich-content span,
.dark .tz-rich-content div:not(.tz-banner):not(.tz-callout):not(.tz-column-list),
.dark .tz-rich-content li,
.dark .tz-rich-content em,
.dark .tz-rich-content strong {
  color: #f8fafc;
}

/* Toggles & Toggle Headings Text Contrast */
.tz-toggle-title {
  color: #0f172a !important;
  font-weight: 700 !important;
}
.dark .tz-toggle-title {
  color: #f8fafc !important;
}
.tz-toggle-body {
  color: #1e293b !important;
}
.dark .tz-toggle-body {
  color: #e2e8f0 !important;
}

/* Quotes */
.tz-quote,
blockquote {
  border-left: 3px solid #6366f1 !important;
  color: #334155 !important;
  font-style: italic;
  padding-left: 0.75rem;
}
.dark .tz-quote,
.dark blockquote {
  color: #cbd5e1 !important;
}

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
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline">$1</a>'
  );
  s = s.replace(/"=""\s*target="_blank"\s*rel="noopener noreferrer"\s*class="text-muted-foreground underline">/gi, "");
  s = s.replace(/<p>\s*<p>/gi, "<p>").replace(/<\/p>\s*<\/p>/gi, "</p>");
  return s;
}


function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline">$1</a>'
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
  // Notion Line-by-Line Block Engine (Vertical Reorder + Clickable Block Menu)
  const [hoveredBlock, setHoveredBlock] = useState<{
    el: HTMLElement;
    top: number;
    left: number;
  } | null>(null);

  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const draggedBlockRef = useRef<HTMLElement | null>(null);

  const [dropIndicator, setDropIndicator] = useState<{
    targetEl: HTMLElement;
    zone: "top" | "bottom";
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);


  const [templates, setTemplates] = useState<SavedTemplate[]>(DEFAULT_TEMPLATES);
  const [defaultAssignments, setDefaultAssignments] = useState<Record<string, string>>({
    day_prep: "tpl-prep",
    day_review: "tpl-review",
    week_prep: "tpl-prep",
    week_review: "tpl-review",
    month_prep: "tpl-prep",
    month_review: "tpl-review",
    quarter_prep: "tpl-prep",
    quarter_review: "tpl-review",
    year_prep: "tpl-prep",
    year_review: "tpl-review",
  });
  const [newTemplateModal, setNewTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    open: boolean;
    images: string[];
    currentIndex: number;
    zoom: number;
    actualSize: boolean;
  }>({ open: false, images: [], currentIndex: 0, zoom: 1, actualSize: false });
  const didInitializeRef = useRef(false);
  const lastSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/journal/config")
      .then((r) => r.json())
      .then((data) => {
        if (!mounted || !data?.config) return;
        if (Array.isArray(data.config.templates) && data.config.templates.length > 0) {
          setTemplates(data.config.templates);
          localStorage.setItem("tz_custom_note_templates", JSON.stringify(data.config.templates));
        }
        if (data.config.defaultTemplates) {
          setDefaultAssignments((prev) => ({ ...prev, ...data.config.defaultTemplates }));
        }
      })
      .catch(() => {
        try {
          const stored = JSON.parse(localStorage.getItem("tz_custom_note_templates") || "null");
          if (Array.isArray(stored) && stored.length > 0) {
            setTemplates(stored);
          }
        } catch {}
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const editor = contentRef.current;
    if (!editor) return;
    // Never replace live content when onChange echoes it back from the parent.
    if (!didInitializeRef.current || value !== lastEmittedRef.current) {
      editor.innerHTML = normalizeIncomingValue(value || "") ||
        (readOnly ? "" : '<p data-placeholder="Type / for commands..."><br/></p>');
      lastEmittedRef.current = value;
      didInitializeRef.current = true;
    }
  }, [value, readOnly]);

  const rememberSelection = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && contentRef.current?.contains(sel.anchorNode)) {
      lastSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    const editor = contentRef.current;
    if (!editor || !sel) return;
    let range: Range | null = null;
    if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else if (lastSelectionRef.current && editor.contains(lastSelectionRef.current.startContainer)) {
      range = lastSelectionRef.current.cloneRange();
    }
    editor.focus();
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const emitChange = () => {
    const html = contentRef.current?.innerHTML;
    if (html === undefined || readOnly) return;
    if (html !== lastEmittedRef.current) {
      lastEmittedRef.current = html;
      onChange(html);
    }
  };

  const insertHtmlAtCursor = (html: string) => {
    if (readOnly || !contentRef.current) return;
    const editor = contentRef.current;
    restoreSelection();
    const sel = window.getSelection();
    let block: HTMLElement | null = null;
    if (sel?.rangeCount) {
      const node = sel.getRangeAt(0).startContainer;
      const parent = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
      const nearest = parent?.closest("p,h1,h2,h3,blockquote,li,.tz-check-row,.tz-toggle,.tz-callout,.tz-figure,.tz-code-block,.tz-banner");
      if (nearest && editor.contains(nearest)) block = nearest as HTMLElement;
    }
    const temp = document.createElement("template");
    temp.innerHTML = html;
    const fragment = temp.content;
    const first = fragment.firstElementChild as HTMLElement | null;
    const last = fragment.lastElementChild as HTMLElement | null;
    if (block && block !== editor) {
      const currentText = (block.textContent || "").trim();
      if (!currentText || /^\/[\w\s-]*$/.test(currentText)) block.replaceWith(fragment);
      else block.after(fragment);
    } else {
      editor.appendChild(fragment);
    }
    // Keep the cursor inside the newly inserted block when possible.
    const editable = (first?.querySelector(".tz-toggle-title,.tz-callout-content,.tz-check-text,p,div,code,td") || first || last) as HTMLElement | null;
    if (editable) {
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      rememberSelection();
    }
    setSlashMenu(s => ({ ...s, open: false, filter: "" }));
    setOpenPopover(null);
    emitChange();
  };

  useImperativeHandle(editorRef, () => ({
    focus: () => restoreSelection(),
    insertText: (text: string) => {
      restoreSelection();
      document.execCommand("insertText", false, text);
      emitChange();
    },
    insertHtml: (html: string) => insertHtmlAtCursor(html),
  }));

  const exec = (command: string, arg?: string) => {
    if (readOnly) return;
    restoreSelection();
    document.execCommand(command, false, arg);
    rememberSelection();
    emitChange();
  };
  const applyBlockType = (tag: string, label: string) => {
    if (tag.startsWith("toggle")) {
      insertToggleBlock(tag === "toggle" ? "toggle" : tag.replace("toggle_", "heading_"));
    } else if (tag === "blockquote") insertQuoteBlock();
    else exec("formatBlock", tag);
    setBlockType(label);
    setOpenPopover(null);
  };
  const applyFontFamily = (label: string, cssValue: string) => {
    exec("fontName", cssValue);
    setFontFamily(label);
    setOpenPopover(null);
  };
  const applyFontSize = (size: number) => setFontSize(Math.min(72, Math.max(9, size)));
  const toggleInlineCode = () => {
    const sel = window.getSelection();
    const chosen = sel?.toString() || "code";
    exec("insertHTML", `<code class="tz-inline-code">${escapeHtml(chosen)}</code>`);
  };
  const applyNotionColor = (id: string, color: string, mode: string) => {
    if (mode === "inline-text") exec("foreColor", color);
    else if (mode === "inline-bg") exec("hiliteColor", color);
    else {
      restoreSelection();
      const anchor = window.getSelection()?.anchorNode;
      const el = anchor?.nodeType === Node.ELEMENT_NODE ? anchor as HTMLElement : anchor?.parentElement;
      const block = el?.closest("p,h1,h2,h3,blockquote,.tz-toggle,.tz-callout,.tz-banner") as HTMLElement | null;
      if (block) {
        for (const name of Array.from(block.classList)) {
          if (name.startsWith("tz-color-") && name.endsWith("_background")) block.classList.remove(name);
        }
        block.classList.add(`tz-color-${id}`);
        block.setAttribute("data-notion-color", id);
        emitChange();
      }
    }
    setOpenPopover(null);
  };

  const insertToggleBlock = (kind: string) => {
    const heading = kind === "toggle" ? "Toggle" : `Toggle heading ${kind.slice(-1)}`;
    const klass = kind === "toggle" ? "tz-toggle" : `tz-toggle tz-toggle-h${kind.slice(-1)}`;
    insertHtmlAtCursor(`<div class="${klass}" data-notion-type="${kind}" data-toggle-type="${kind}" data-open="true"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▾</span><div class="tz-toggle-title">${heading}</div></div><div class="tz-toggle-body"><p><br/></p></div></div>`);
  };
  const insertColumnsBlock = (n: number) => insertHtmlAtCursor(
    `<div class="tz-column-list" data-notion-type="column_list" data-columns="${n}">${Array.from({ length: n }, (_, i) => `<div class="tz-column" data-notion-type="column"><p data-placeholder="Column ${i + 1}..."><br/></p></div>`).join("")}</div>`
  );
  const insertCallout = (icon: string, bg: string) => insertHtmlAtCursor(
    `<div class="tz-callout tz-color-${bg}" data-notion-type="callout" data-notion-color="${bg}" data-icon="${icon}"><span class="tz-callout-icon" contenteditable="false">${icon}</span><div class="tz-callout-content"><p>Callout note...</p></div></div>`
  );
  const insertQuoteBlock = () => insertHtmlAtCursor('<blockquote class="tz-quote" data-notion-type="quote"><div>Quote...</div></blockquote>');
  const insertDivider = () => insertHtmlAtCursor('<hr class="tz-divider" data-notion-type="divider"/>');
  const insertChecklistItem = () => insertHtmlAtCursor('<div class="tz-check-row" data-notion-type="to_do"><input type="checkbox" class="tz-inline-checkbox" contenteditable="false"/><div class="tz-check-text">To-do item</div></div>');
  const insertCodeBlock = (lang: string) => insertHtmlAtCursor(`<div class="tz-code-block" data-notion-type="code"><div class="tz-code-header">${escapeHtml(lang)}</div><pre><code>Code...</code></pre></div>`);
  const insertTable = () => insertHtmlAtCursor('<table class="tz-table" data-notion-type="table"><tbody><tr><th>Column 1</th><th>Column 2</th></tr><tr><td> </td><td> </td></tr></tbody></table>');
  const insertBookmarkBlock = () => {
    const raw = window.prompt("Bookmark URL (https://...):");
    if (!raw) return;
    let url: URL;
    try { url = new URL(raw); } catch { window.alert("Invalid URL"); return; }
    if (!["https:", "http:"].includes(url.protocol)) { window.alert("Only HTTP(S) URLs are supported"); return; }
    const safe = escapeHtml(url.toString());
    insertHtmlAtCursor(`<div class="tz-bookmark" data-notion-type="bookmark"><a class="tz-bookmark-link" href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a><div class="tz-bookmark-caption">Bookmark</div></div>`);
  };
  const insertEquationBlock = () => {
    const equation = window.prompt("Equation / formula:", "R = reward / risk");
    if (equation !== null) insertHtmlAtCursor(`<div class="tz-equation" data-notion-type="equation"><span class="tz-equation-symbol">∑</span><span>${escapeHtml(equation)}</span></div>`);
  };

  const insertNotionButtonBlock = () => {
    const label = window.prompt("Button label (e.g., + Add Asset Toggle, + Add Trade Section):", "+ Add Asset Toggle");
    if (!label) return;
    const defaultSpawnHtml = `<div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="true"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▾</span><div class="tz-toggle-title"><strong>New Asset / Section</strong></div></div><div class="tz-toggle-body"><p data-placeholder="Type notes or paste chart..."><br/></p></div></div>`;
    const payloadB64 = typeof window !== "undefined" ? window.btoa(unescape(encodeURIComponent(defaultSpawnHtml))) : "";
    insertHtmlAtCursor(
      `<div class="tz-notion-btn-wrapper" data-notion-type="button" data-btn-label="${escapeHtml(label)}" data-btn-payload="${payloadB64}" contenteditable="false"><button type="button" class="tz-notion-action-btn"><span class="tz-notion-btn-icon">＋</span><span class="tz-notion-btn-text">${escapeHtml(label)}</span></button><button type="button" class="tz-notion-btn-config" title="Configure button label &amp; spawned blocks">⚙</button></div><p><br/></p>`
    );
  };

  const openLightboxForImage = (src: string) => {
    const images = Array.from(contentRef.current?.querySelectorAll("img") || []).map(img => img.src);
    const index = images.indexOf(src);
    setLightbox({
      open: true,
      images: images.length ? images : [src],
      currentIndex: Math.max(0, index),
      zoom: 1,
      actualSize: false,
    });
  };
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const actionBtn = target.closest(".tz-notion-action-btn");
    if (actionBtn && !readOnly) {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = actionBtn.closest(".tz-notion-btn-wrapper") as HTMLElement | null;
      if (wrapper) {
        const payloadB64 = wrapper.getAttribute("data-btn-payload") || "";
        let spawnHtml = `<div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="true"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▾</span><div class="tz-toggle-title"><strong>New Section</strong></div></div><div class="tz-toggle-body"><p><br/></p></div></div>`;
        if (payloadB64) {
          try {
            spawnHtml = decodeURIComponent(escape(window.atob(payloadB64)));
          } catch {}
        }
        const temp = document.createElement("template");
        temp.innerHTML = spawnHtml;
        wrapper.after(temp.content);
        emitChange();
      }
      return;
    }

    const configBtn = target.closest(".tz-notion-btn-config");
    if (configBtn && !readOnly) {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = configBtn.closest(".tz-notion-btn-wrapper") as HTMLElement | null;
      if (wrapper) {
        const currentLabel = wrapper.getAttribute("data-btn-label") || "+ Add Block";
        const nextLabel = window.prompt(
          "Edit Button Label (or type 'DELETE' to remove button):",
          currentLabel
        );
        if (nextLabel === null) return;
        if (nextLabel.trim().toUpperCase() === "DELETE") {
          wrapper.remove();
          emitChange();
          return;
        }
        wrapper.setAttribute("data-btn-label", nextLabel.trim());
        const textSpan = wrapper.querySelector(".tz-notion-btn-text");
        if (textSpan) textSpan.textContent = nextLabel.trim();

        const presetChoice = window.prompt(
          "Choose what this button spawns when clicked:\n1 = Collapsible Toggle\n2 = 2-Column Layout\n3 = Callout Box\n4 = To-Do Checklist\n(Leave blank to keep current)",
          ""
        );
        let newSpawn = "";
        if (presetChoice === "1") {
          newSpawn = `<div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="true"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▾</span><div class="tz-toggle-title"><strong>New Toggle</strong></div></div><div class="tz-toggle-body"><p><br/></p></div></div>`;
        } else if (presetChoice === "2") {
          newSpawn = `<div class="tz-column-list" data-notion-type="column_list" data-columns="2"><div class="tz-column" data-notion-type="column"><p><br/></p></div><div class="tz-column" data-notion-type="column"><p><br/></p></div></div>`;
        } else if (presetChoice === "3") {
          newSpawn = `<div class="tz-callout tz-color-blue_background" data-notion-type="callout" data-notion-color="blue_background" data-icon="💡"><span class="tz-callout-icon" contenteditable="false">💡</span><div class="tz-callout-content"><p>Note...</p></div></div>`;
        } else if (presetChoice === "4") {
          newSpawn = `<div class="tz-check-row" data-notion-type="to_do"><input type="checkbox" class="tz-inline-checkbox"/><div class="tz-check-text">To-do item</div></div>`;
        }
        if (newSpawn) {
          wrapper.setAttribute("data-btn-payload", window.btoa(unescape(encodeURIComponent(newSpawn))));
        }
        emitChange();
      }
      return;
    }

    const toggle = target.closest(".tz-toggle-btn");
    if (toggle) {
      e.preventDefault();
      const block = toggle.closest(".tz-toggle") as HTMLElement | null;
      const opened = block?.getAttribute("data-open") !== "false";
      block?.setAttribute("data-open", opened ? "false" : "true");
      toggle.textContent = opened ? "▸" : "▾";
      const body = block?.querySelector(":scope > .tz-toggle-body") as HTMLElement | null;
      if (body) body.style.display = opened ? "none" : "block";
      emitChange();
    } else if (target.closest(".tz-callout-icon")) {
      const icon = target.closest(".tz-callout-icon")!;
      const value = window.prompt("Callout icon:", icon.textContent || "💡");
      if (value) {
        icon.textContent = value;
        icon.closest(".tz-callout")?.setAttribute("data-icon", value);
        emitChange();
      }
    }
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      if (target.checked) target.setAttribute("checked", "checked");
      else target.removeAttribute("checked");
      emitChange();
    }
    setSelectedImg(target.tagName === "IMG" ? target as HTMLImageElement : null);
    rememberSelection();
  };

  const insertImageFile = async (file: File) => {
    if (readOnly || !file.type.startsWith("image/")) return;
    try {
      const bitmap = await createImageBitmap(file);
      // Sweet spot for 200-400 charts/week: 2560px (QHD) max width @ 0.92 WebP (~120KB/chart, razor-sharp text)
      const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      }
      bitmap.close();
      const data = canvas.toDataURL("image/webp", 0.92);
      insertHtmlAtCursor(`<figure class="tz-figure" data-notion-type="image"><img src="${data}" alt="${escapeHtml(file.name)}" style="width:100%;height:auto"/><figcaption class="tz-block-caption"></figcaption></figure>`);
    } catch (error) { console.error("Failed to insert image", error); }
  };
  useEffect(() => {
    if (!lightbox.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox((s) => ({ ...s, open: false }));
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        setLightbox((s) => ({
          ...s,
          currentIndex:
            (s.currentIndex + (e.key === "ArrowLeft" ? -1 : 1) + s.images.length) %
            s.images.length,
          zoom: 1,
          actualSize: false,
        }));
      } else if (e.key === "+" || e.key === "=") {
        setLightbox((s) => ({ ...s, actualSize: false, zoom: Math.min(4, +(s.zoom + 0.25).toFixed(2)) }));
      } else if (e.key === "-") {
        setLightbox((s) => ({ ...s, actualSize: false, zoom: Math.max(0.5, +(s.zoom - 0.25).toFixed(2)) }));
      } else if (e.key === "0") {
        setLightbox((s) => ({ ...s, actualSize: false, zoom: 1 }));
      } else if (e.key === "1") {
        setLightbox((s) => ({ ...s, actualSize: !s.actualSize, zoom: 1 }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox.open]);

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(e.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (images.length) {
      e.preventDefault();
      images.forEach(file => { void insertImageFile(file); });
    }
  };

  // Ensure every bare text node or div is normalized into a discrete movable block
  const ensureLineBlocks = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    Array.from(container.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim()) {
        const p = document.createElement("p");
        p.textContent = node.textContent;
        container.replaceChild(p, node);
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).tagName === "DIV" &&
        !(node as HTMLElement).className
      ) {
        const div = node as HTMLElement;
        const p = document.createElement("p");
        p.innerHTML = div.innerHTML || "<br/>";
        container.replaceChild(p, div);
      }
    });

    if (container.children.length === 0 && !readOnly) {
      const p = document.createElement("p");
      p.setAttribute("data-placeholder", placeholder);
      p.innerHTML = "<br/>";
      container.appendChild(p);
    }
  }, [placeholder, readOnly]);

  // Identify the exact line-level block under the cursor (works at root, inside columns, and inside toggles)
  const findDraggableBlock = (target: HTMLElement | null): HTMLElement | null => {
    const container = contentRef.current;
    if (!target || !container || target === container) return null;

    let curr: HTMLElement | null = target;
    while (curr && curr !== container) {
      const parent: HTMLElement | null = curr.parentElement;
      if (!parent) break;

      // Never treat internal structural parts of a toggle or column wrapper as standalone blocks
      if (
        curr.classList.contains("tz-toggle-header") ||
        curr.classList.contains("tz-toggle-title") ||
        curr.classList.contains("tz-toggle-btn") ||
        curr.classList.contains("tz-toggle-body") ||
        curr.classList.contains("tz-column")
      ) {
        curr = parent;
        continue;
      }

      if (
        parent === container ||
        parent.classList.contains("tz-column") ||
        parent.classList.contains("tz-toggle-body")
      ) {
        return curr;
      }
      curr = parent;
    }
    return null;
  };

  const handleEditorMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || draggedBlockRef.current || blockMenuOpen) return;
    const container = contentRef.current;
    if (!container) return;

    const target = e.target as HTMLElement;
    if (target.closest(".tz-gutter-controls")) return;

    const blockEl = findDraggableBlock(target);
    if (!blockEl) {
      if (!blockMenuOpen) setHoveredBlock(null);
      return;
    }

    const wrapper = container.parentElement;
    if (!wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const blockRect = blockEl.getBoundingClientRect();

    setHoveredBlock({
      el: blockEl,
      top: Math.max(4, blockRect.top - wrapperRect.top + 2),
      left: Math.max(4, blockRect.left - wrapperRect.left - 42),
    });
  };

  const handleBlockDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    if (!hoveredBlock?.el) return;
    setBlockMenuOpen(false);
    const block = hoveredBlock.el;
    draggedBlockRef.current = block;
    block.classList.add("tz-block-dragging");
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", "tz-block");
    } catch {}
  };

  const handleBlockDragEnd = () => {
    if (draggedBlockRef.current) {
      draggedBlockRef.current.classList.remove("tz-block-dragging");
      draggedBlockRef.current = null;
    }
    setDropIndicator(null);
  };

  // Strict Vertical-Only Drag Over (Never accidentally splits into columns!)
  const handleEditorDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const dragged = draggedBlockRef.current;
    const container = contentRef.current;
    if (!dragged || !container) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const target = e.target as HTMLElement;

    // Allow dropping directly into an empty column
    const colTarget = target.closest(".tz-column") as HTMLElement | null;
    const targetBlock = findDraggableBlock(target);

    const wrapper = container.parentElement;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();

    if (!targetBlock && colTarget) {
      const colRect = colTarget.getBoundingClientRect();
      setDropIndicator({
        targetEl: colTarget,
        zone: "top",
        rect: {
          top: colRect.top - wrapperRect.top + 8,
          left: colRect.left - wrapperRect.left + 8,
          width: colRect.width - 16,
          height: 4,
        },
      });
      return;
    }

    if (!targetBlock || targetBlock === dragged || dragged.contains(targetBlock)) {
      setDropIndicator(null);
      return;
    }

    const rect = targetBlock.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const zone: "top" | "bottom" = relY < rect.height / 2 ? "top" : "bottom";

    setDropIndicator({
      targetEl: targetBlock,
      zone,
      rect: {
        top: rect.top - wrapperRect.top,
        left: rect.left - wrapperRect.left,
        width: rect.width,
        height: rect.height,
      },
    });
  };

  const executeBlockDrop = () => {
    const dragged = draggedBlockRef.current;
    if (!dragged || !dropIndicator) return;

    const { targetEl, zone } = dropIndicator;
    if (targetEl === dragged || dragged.contains(targetEl)) return;

    // If dropped directly into a column container
    if (targetEl.classList.contains("tz-column")) {
      targetEl.appendChild(dragged);
    } else if (zone === "top") {
      targetEl.parentNode?.insertBefore(dragged, targetEl);
    } else {
      targetEl.parentNode?.insertBefore(dragged, targetEl.nextSibling);
    }

    dragged.classList.remove("tz-block-dragging");
    draggedBlockRef.current = null;
    setDropIndicator(null);
    emitChange();
  };

  const handleAddBlockBelowHovered = () => {
    const refEl = hoveredBlock?.el;
    const p = document.createElement("p");
    p.setAttribute("data-placeholder", "Type '/' for commands...");
    p.innerHTML = "<br/>";

    if (refEl && refEl.parentNode) {
      refEl.parentNode.insertBefore(p, refEl.nextSibling);
    } else {
      contentRef.current?.appendChild(p);
    }

    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(p, 0);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    emitChange();
  };

  // Block Action Menu Operations (Delete, Duplicate, Turn Into)
  const deleteHoveredBlock = () => {
    if (!hoveredBlock?.el) return;
    const el = hoveredBlock.el;
    const parent = el.parentElement;
    el.remove();
    setBlockMenuOpen(false);
    setHoveredBlock(null);
    // Ensure a column or editor never becomes completely unclickable
    if (parent && parent.classList.contains("tz-column") && parent.children.length === 0) {
      const p = document.createElement("p");
      p.setAttribute("data-placeholder", "Column...");
      p.innerHTML = "<br/>";
      parent.appendChild(p);
    }
    ensureLineBlocks();
    emitChange();
  };

  const duplicateHoveredBlock = () => {
    if (!hoveredBlock?.el) return;
    const clone = hoveredBlock.el.cloneNode(true) as HTMLElement;
    hoveredBlock.el.parentNode?.insertBefore(clone, hoveredBlock.el.nextSibling);
    setBlockMenuOpen(false);
    emitChange();
  };

  const turnHoveredBlockInto = (kind: string) => {
    if (!hoveredBlock?.el) return;
    const el = hoveredBlock.el;
    const textContent = (el.textContent || "").trim();

    let replacementHtml = "";
    if (kind === "p") {
      replacementHtml = `<p data-placeholder="Type '/' for commands...">${textContent || "<br/>"}</p>`;
    } else if (kind === "h1" || kind === "h2" || kind === "h3") {
      replacementHtml = `<${kind}>${textContent || `Heading ${kind.slice(1)}`}</${kind}>`;
    } else if (kind === "toggle") {
      replacementHtml = `
        <div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="true">
          <div class="tz-toggle-header">
            <span class="tz-toggle-btn" contenteditable="false">▾</span>
            <div class="tz-toggle-title"><strong>${textContent || "Toggle"}</strong></div>
          </div>
          <div class="tz-toggle-body"><p data-placeholder="Empty toggle. Type or drop blocks here..."><br/></p></div>
        </div>`;
    } else if (kind === "toggle_h2") {
      replacementHtml = `
        <div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="true">
          <div class="tz-toggle-header">
            <span class="tz-toggle-btn" contenteditable="false">▾</span>
            <div class="tz-toggle-title"><strong>${textContent || "Toggle Heading 2"}</strong></div>
          </div>
          <div class="tz-toggle-body"><p data-placeholder="Empty toggle. Type or drop blocks here..."><br/></p></div>
        </div>`;
    } else if (kind === "callout") {
      replacementHtml = `
        <div class="tz-callout tz-color-blue_background" data-notion-type="callout" data-notion-color="blue_background" data-icon="💡">
          <span class="tz-callout-icon" contenteditable="false">💡</span>
          <div class="tz-callout-content"><div>${textContent || "Callout note..."}</div></div>
        </div>`;
    } else if (kind === "quote") {
      replacementHtml = `<blockquote class="tz-quote" data-notion-type="quote"><div data-placeholder="Empty quote">${textContent || ""}</div></blockquote>`;
    } else if (kind === "todo") {
      replacementHtml = `
        <div class="tz-check-row" data-notion-type="to_do">
          <input type="checkbox" class="tz-inline-checkbox" />
          <div class="tz-check-text">${textContent || "To-do item"}</div>
        </div>`;
    } else if (kind === "banner_gray" || kind === "banner_brown") {
      const bg = kind === "banner_brown" ? "brown_background" : "gray_background";
      replacementHtml = `<div class="tz-banner tz-color-${bg}" data-notion-type="paragraph" data-notion-color="${bg}"><strong>${textContent || "Section Header"}</strong></div>`;
    } else if (kind === "cols_2" || kind === "cols_3") {
      const count = kind === "cols_3" ? 3 : 2;
      const cols = Array.from({ length: count })
        .map(
          (_, idx) => `
          <div class="tz-column" data-notion-type="column">
            <p data-placeholder="Column ${idx + 1}...">${idx === 0 && textContent ? textContent : "<br/>"}</p>
          </div>`
        )
        .join("");
      replacementHtml = `<div class="tz-column-list" data-notion-type="column_list" data-columns="${count}">${cols}</div>`;
    }

    if (replacementHtml) {
      const temp = document.createElement("div");
      temp.innerHTML = replacementHtml.trim();
      const newEl = temp.firstElementChild as HTMLElement | null;
      if (newEl && el.parentNode) {
        el.parentNode.replaceChild(newEl, el);
        setHoveredBlock((prev) => (prev ? { ...prev, el: newEl } : null));
      }
    }
    setBlockMenuOpen(false);
    emitChange();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (draggedBlockRef.current && dropIndicator) {
      e.preventDefault();
      e.stopPropagation();
      executeBlockDrop();
      return;
    }
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
      setBlockMenuOpen(false);
      return;
    }

    // Block-aware ArrowDown / ArrowUp navigation so empty blocks & columns are never skipped
    if (
      (e.key === "ArrowDown" || e.key === "ArrowUp") &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !slashMenu.open
    ) {
      const container = contentRef.current;
      const sel = window.getSelection();
      if (container && sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const anchorNode = sel.anchorNode;
        const anchorEl =
          anchorNode?.nodeType === Node.ELEMENT_NODE
            ? (anchorNode as HTMLElement)
            : anchorNode?.parentElement;

        if (anchorEl && container.contains(anchorEl)) {
          // Collect all visible leaf editable blocks in DOM order
          const allCandidates = Array.from(
            container.querySelectorAll<HTMLElement>(
              "p, h1, h2, h3, blockquote, li, .tz-toggle-title, .tz-check-text, .tz-callout-content, .tz-banner"
            )
          ).filter((el) => {
            // Skip elements inside collapsed toggles
            const closedToggleBody = el.closest('.tz-toggle-body[style*="display: none"], .tz-toggle-body[style*="display:none"]');
            if (closedToggleBody) return false;
            return el.offsetParent !== null;
          });

          const currentBlock = anchorEl.closest<HTMLElement>(
            "p, h1, h2, h3, blockquote, li, .tz-toggle-title, .tz-check-text, .tz-callout-content, .tz-banner"
          );

          if (currentBlock) {
            const idx = allCandidates.indexOf(currentBlock);
            if (idx !== -1) {
              const blockRect = currentBlock.getBoundingClientRect();
              const caretRect = range.getBoundingClientRect();
              const isEmptyBlock = !(currentBlock.textContent || "").trim();

              // Check if caret is on the very last visual line (for ArrowDown) or first visual line (for ArrowUp)
              const atBottomLine =
                isEmptyBlock ||
                caretRect.bottom === 0 ||
                blockRect.bottom - caretRect.bottom < 14;
              const atTopLine =
                isEmptyBlock ||
                caretRect.top === 0 ||
                caretRect.top - blockRect.top < 14;

              if (e.key === "ArrowDown" && atBottomLine) {
                const nextBlock = allCandidates[idx + 1];
                if (nextBlock) {
                  e.preventDefault();
                  const nextRange = document.createRange();
                  nextRange.selectNodeContents(nextBlock);
                  nextRange.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(nextRange);
                  nextBlock.scrollIntoView({ block: "nearest" });
                  rememberSelection();
                  return;
                } else {
                  // At the very last block in the editor: create a new empty paragraph below if current has content
                  if (!isEmptyBlock) {
                    e.preventDefault();
                    const p = document.createElement("p");
                    p.setAttribute("data-placeholder", "Type '/' for commands...");
                    p.innerHTML = "<br/>";
                    container.appendChild(p);
                    const nextRange = document.createRange();
                    nextRange.setStart(p, 0);
                    nextRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(nextRange);
                    rememberSelection();
                    emitChange();
                    return;
                  }
                }
              } else if (e.key === "ArrowUp" && atTopLine && idx > 0) {
                const prevBlock = allCandidates[idx - 1];
                if (prevBlock) {
                  e.preventDefault();
                  const prevRange = document.createRange();
                  prevRange.selectNodeContents(prevBlock);
                  prevRange.collapse(false);
                  sel.removeAllRanges();
                  sel.addRange(prevRange);
                  prevBlock.scrollIntoView({ block: "nearest" });
                  rememberSelection();
                  return;
                }
              }
            }
          }
        }
      }
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
            p.setAttribute("data-placeholder", "Type '/' for commands...");
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

      // Pressing Enter inside a To-Do checklist row creates a new To-Do row below (or exits if empty)
      const checkRow = anchorEl.closest(".tz-check-row") as HTMLElement | null;
      if (checkRow) {
        e.preventDefault();
        const text = (checkRow.textContent || "").trim();
        if (!text) {
          const p = document.createElement("p");
          p.setAttribute("data-placeholder", "Type '/' for commands...");
          p.innerHTML = "<br/>";
          checkRow.parentNode?.replaceChild(p, checkRow);
          const range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(range);
        } else {
          const nextRow = document.createElement("div");
          nextRow.className = "tz-check-row";
          nextRow.setAttribute("data-notion-type", "to_do");
          nextRow.innerHTML = `<input type="checkbox" class="tz-inline-checkbox" /><div class="tz-check-text"><br/></div>`;
          checkRow.parentNode?.insertBefore(nextRow, checkRow.nextSibling);
          const textDiv = nextRow.querySelector(".tz-check-text")!;
          const range = document.createRange();
          range.setStart(textDiv, 0);
          range.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
        emitChange();
        return;
      }

      // Pressing Enter inside a Banner or Quote exits cleanly into a new paragraph block below
      const specialBlock = anchorEl.closest(".tz-banner, .tz-quote, blockquote, h1, h2, h3") as HTMLElement | null;
      if (specialBlock) {
        e.preventDefault();
        const p = document.createElement("p");
        p.setAttribute("data-placeholder", "Type '/' for commands...");
        p.innerHTML = "<br/>";
        specialBlock.parentNode?.insertBefore(p, specialBlock.nextSibling);
        const range = document.createRange();
        range.setStart(p, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
        emitChange();
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

  const persistTemplatesAndDefaults = (
    nextTemplates: SavedTemplate[],
    nextDefaults: Record<string, string> = defaultAssignments
  ) => {
    setTemplates(nextTemplates);
    setDefaultAssignments(nextDefaults);
    try {
      localStorage.setItem("tz_custom_note_templates", JSON.stringify(nextTemplates));
    } catch {}
    void fetch("/api/journal/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templates: nextTemplates,
        defaultTemplates: nextDefaults,
        triggerAutoPopulate: true,
      }),
    });
  };

  const handleSaveCustomTemplate = () => {
    const name = newTemplateName.trim();
    if (!name || !contentRef.current) return;
    if (editingTemplateId) {
      const next = templates.map((t) =>
        t.id === editingTemplateId
          ? { ...t, name, html: contentRef.current?.innerHTML || t.html }
          : t
      );
      persistTemplatesAndDefaults(next);
      setEditingTemplateId(null);
      setNewTemplateName("");
      return;
    }
    const newTpl: SavedTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      html: contentRef.current.innerHTML,
    };
    persistTemplatesAndDefaults([...templates, newTpl]);
    setNewTemplateName("");
  };

  const handleUpdateTemplateHtmlFromEditor = (id: string) => {
    if (!contentRef.current) return;
    const next = templates.map((t) =>
      t.id === id ? { ...t, html: contentRef.current?.innerHTML || t.html } : t
    );
    persistTemplatesAndDefaults(next);
  };

  const handleDeleteTemplate = (id: string) => {
    const next = templates.filter((t) => t.id !== id);
    persistTemplatesAndDefaults(next);
    if (editingTemplateId === id) {
      setEditingTemplateId(null);
      setNewTemplateName("");
    }
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
      label: "Notion Button",
      desc: "Interactive button that spawns blocks when clicked (syncs with Notion)",
      action: insertNotionButtonBlock,
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
        fullscreen ? "fixed inset-0 z-[9999] bg-background flex flex-col h-screen w-screen overflow-y-auto p-4 md:p-8"
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
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => insertHtmlAtCursor(tpl.html)}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-foreground/90 hover:border-indigo-500/60 hover:text-foreground transition-colors"
                title="Click to insert template at cursor"
              >
                <span>{tpl.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setEditingTemplateId(null);
                setNewTemplateName("");
                setNewTemplateModal(true);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              <span>Manage templates</span>
            </button>
          </div>
        </div>
      )}

      {/* MAIN EDITOR CONTAINER */}
      <div className="flex-1 rounded-xl border border-border/60 bg-[#0d0f14] shadow-inner overflow-visible shrink-0">
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-slate-200 dark:border-border/80 bg-card p-1 shadow-2xl space-y-0.5">
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-slate-200 dark:border-border/80 bg-card p-1 shadow-2xl space-y-0.5">
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-slate-200 dark:border-border/80 bg-card p-3 shadow-2xl space-y-3">
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-slate-200 dark:border-border/80 bg-card p-1.5 shadow-2xl space-y-0.5">
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("toggle")}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground font-medium hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span>Toggle list</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("heading_2")}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground font-medium hover:bg-secondary/50"
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
                className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-[#181b26] px-2 text-[11px] font-medium text-foreground hover:border-indigo-500/50"
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-64 max-h-96 overflow-y-auto rounded-xl border border-slate-200 dark:border-border/80 bg-card p-1.5 shadow-2xl space-y-0.5">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Toggles &amp; Headings
                    </div>
                    <button
                      type="button"
                      onClick={() => insertToggleBlock("toggle")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
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
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
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
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
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
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
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
                      <Quote className="h-4 w-4 text-foreground shrink-0" />
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
                      <Bookmark className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <div className="font-semibold">Web Bookmark</div>
                        <div className="text-[10px] text-muted-foreground">
                          TradingView or Notion link card
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenPopover(null);
                        insertNotionButtonBlock();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary/50"
                    >
                      <Plus className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Notion Button Block</div>
                        <div className="text-[10px] text-muted-foreground">
                          Clickable block spawner (bridges with Notion)
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

              {/* Right Controls: Undo, Redo, Fullscreen inline on same row */}
              <div className="ml-auto flex items-center gap-1">
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
          </div>
        )}

        {/* SELECTED IMAGE RESIZE & CAPTION BAR */}
        {selectedImg && !readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/30 bg-secondary text-foreground border border-border font-medium/10 px-3 py-1.5 text-xs">
            <span className="text-[11px] font-medium text-foreground">
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
                  className="rounded bg-card px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-secondary text-foreground border border-border font-medium hover:text-white"
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
                className="rounded bg-card px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-secondary text-foreground border border-border font-medium hover:text-white"
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

        {/* WYSIWYG EDITABLE SURFACE WITH NOTION LINE-BY-LINE BLOCK GUTTER & CONTEXT MENU */}
        <div
          className="relative flex-1"
          onMouseLeave={() => {
            if (!blockMenuOpen && !draggedBlockRef.current) {
              setHoveredBlock(null);
            }
          }}
        >
          {!readOnly && hoveredBlock && (
            <div
              style={{
                top: hoveredBlock.top,
                left: hoveredBlock.left,
              }}
              className="tz-gutter-controls absolute z-30 flex items-center gap-0.5 rounded-md bg-white dark:bg-card/95 px-1 py-0.5 border border-border shadow-md transition-all duration-75"
              contentEditable={false}
            >
              <button
                type="button"
                onClick={handleAddBlockBelowHovered}
                title="Click to insert a new block below"
                className="flex h-5 w-4 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                draggable
                onClick={() => setBlockMenuOpen((o) => !o)}
                onDragStart={handleBlockDragStart}
                onDragEnd={handleBlockDragEnd}
                title="Drag to move line up/down • Click to open Block Menu (Turn into, Duplicate, Delete)"
                className="flex h-5 w-4 cursor-grab active:cursor-grabbing items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-white"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>

              {/* NOTION BLOCK ACTION MENU (OPENS ON CLICKING ⋮⋮) */}
              {blockMenuOpen && (
                <div className="absolute left-0 top-full mt-1 w-52 rounded-xl border border-slate-200 dark:border-border/80 bg-card p-1.5 shadow-2xl z-50 text-xs space-y-0.5">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Block Actions
                  </div>
                  <button
                    type="button"
                    onClick={duplicateHoveredBlock}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-foreground hover:bg-secondary/60"
                  >
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Duplicate block</span>
                  </button>
                  <button
                    type="button"
                    onClick={deleteHoveredBlock}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-rose-400 hover:bg-rose-500/15"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete block</span>
                  </button>

                  <div className="my-1 border-t border-border/40" />
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Turn into
                  </div>
                  {[
                    { id: "p", label: "Text (Paragraph)" },
                    { id: "h1", label: "Heading 1" },
                    { id: "h2", label: "Heading 2" },
                    { id: "h3", label: "Heading 3" },
                    { id: "toggle", label: "Toggle list" },
                    { id: "toggle_h2", label: "Toggle Heading 2" },
                    { id: "todo", label: "To-do checklist" },
                    { id: "callout", label: "Callout box" },
                    { id: "quote", label: "Quote block" },
                    { id: "banner_gray", label: "Gray Section Banner" },
                    { id: "banner_brown", label: "Brown Perspective Banner" },
                    { id: "cols_2", label: "2 Columns Layout" },
                    { id: "cols_3", label: "3 Columns Layout" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => turnHoveredBlockInto(item.id)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-foreground hover:bg-secondary/60"
                    >
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* HORIZONTAL DROP LINE INDICATOR (TOP OR BOTTOM ONLY) */}
          {dropIndicator && (
            <div
              style={{
                top:
                  dropIndicator.zone === "top"
                    ? dropIndicator.rect.top - 2
                    : dropIndicator.rect.top + dropIndicator.rect.height - 1,
                left: dropIndicator.rect.left,
                width: dropIndicator.rect.width,
                height: 3,
              }}
              className="pointer-events-none absolute z-40 rounded-full bg-secondary text-foreground border border-border font-medium shadow-[0_0_10px_#6366f1]"
            />
          )}

        <div
          ref={contentRef}
          onMouseMove={handleEditorMouseMove}
          onDragOver={handleEditorDragOver}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={() => {
            ensureLineBlocks();
            emitChange();
          }}
          onMouseUp={rememberSelection}
          onKeyUp={rememberSelection}
          onBlur={() => { rememberSelection(); emitChange(); }}
          onClick={(e) => {
            setBlockMenuOpen(false);
            handleEditorClick(e);
          }}
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
          style={{ minHeight: fullscreen ? "calc(100vh - 140px)" : minHeight, fontSize: `${fontSize}px` }}
          className="tz-rich-content p-4 md:p-6 text-sm overflow-y-auto"
        />
        </div>

        {/* SLASH (`/`) COMMAND MENU */}
        {slashMenu.open && (
          <div
            style={{ left: slashMenu.x, top: slashMenu.y }}
            className="absolute z-50 w-68 rounded-xl border border-slate-200 dark:border-border/80 bg-card p-1.5 shadow-2xl animate-in fade-in-50 zoom-in-95"
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

      
      {/* LIGHTBOX MODAL WITH FULLSCREEN CENTER-PEEK, ZOOM CONTROLS & ACTUAL SIZE TOGGLE */}
      {lightbox.open && lightbox.images.length > 0 && (
        <div
          onClick={() => setLightbox((s) => ({ ...s, open: false }))}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey || lightbox.zoom > 1) {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.2 : -0.2;
              setLightbox((s) => ({
                ...s,
                actualSize: false,
                zoom: Math.min(4, Math.max(0.5, +(s.zoom + delta).toFixed(2))),
              }));
            }
          }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-between bg-black/92 p-2 sm:p-4 backdrop-blur-md animate-in fade-in"
        >
          {/* Scrollable / Pannable Image Viewport */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setLightbox((s) => ({ ...s, open: false }));
              }
            }}
            className="relative flex-1 w-full overflow-auto flex items-center justify-center"
          >
            <img
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setLightbox((s) => ({
                  ...s,
                  actualSize: !s.actualSize,
                  zoom: 1,
                }));
              }}
              src={lightbox.images[lightbox.currentIndex]}
              alt={`Chart ${lightbox.currentIndex + 1}`}
              style={
                lightbox.actualSize
                  ? {
                      width: "auto",
                      height: "auto",
                      maxWidth: "none",
                      maxHeight: "none",
                      transform: `scale(${lightbox.zoom})`,
                      transformOrigin: "center center",
                    }
                  : {
                      width: `${Math.round(96 * lightbox.zoom)}vw`,
                      height: `${Math.round(90 * lightbox.zoom)}vh`,
                      maxWidth: lightbox.zoom === 1 ? "96vw" : "none",
                      maxHeight: lightbox.zoom === 1 ? "90vh" : "none",
                    }
              }
              className={`rounded-lg shadow-2xl select-none transition-all duration-100 ${
                lightbox.actualSize ? "cursor-zoom-out" : "object-contain cursor-zoom-in"
              }`}
              title="Double-click to toggle Actual Size (1:1)"
            />
          </div>

          {/* Bottom HUD Control Bar */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs font-semibold text-white/90 bg-zinc-950/90 px-4 py-1.5 rounded-full border border-white/15 shadow-2xl z-10"
          >
            <button
              type="button"
              onClick={() =>
                setLightbox((s) => ({
                  ...s,
                  currentIndex:
                    (s.currentIndex - 1 + s.images.length) % s.images.length,
                  zoom: 1,
                  actualSize: false,
                }))
              }
              className="px-2 py-0.5 hover:text-white rounded hover:bg-white/10 transition"
            >
              ◀ Prev (←)
            </button>
            <span className="tabular-nums text-white/70">
              {lightbox.currentIndex + 1} / {lightbox.images.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setLightbox((s) => ({
                  ...s,
                  currentIndex: (s.currentIndex + 1) % s.images.length,
                  zoom: 1,
                  actualSize: false,
                }))
              }
              className="px-2 py-0.5 hover:text-white rounded hover:bg-white/10 transition"
            >
              Next (→) ▶
            </button>

            <span className="text-white/20">|</span>

            {/* Zoom Controls */}
            <button
              type="button"
              onClick={() =>
                setLightbox((s) => ({
                  ...s,
                  actualSize: false,
                  zoom: Math.max(0.5, +(s.zoom - 0.25).toFixed(2)),
                }))
              }
              className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/15 text-white transition"
              title="Zoom Out (-)"
            >
              −
            </button>
            <span className="min-w-[44px] text-center tabular-nums">
              {lightbox.actualSize ? "1:1" : `${Math.round(lightbox.zoom * 100)}%`}
            </span>
            <button
              type="button"
              onClick={() =>
                setLightbox((s) => ({
                  ...s,
                  actualSize: false,
                  zoom: Math.min(4, +(s.zoom + 0.25).toFixed(2)),
                }))
              }
              className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/15 text-white transition"
              title="Zoom In (+)"
            >
              +
            </button>

            {/* Fit vs Actual Size (1:1) Toggle */}
            <button
              type="button"
              onClick={() =>
                setLightbox((s) => ({
                  ...s,
                  actualSize: false,
                  zoom: 1,
                }))
              }
              className={`px-2.5 py-0.5 rounded transition ${
                !lightbox.actualSize && lightbox.zoom === 1
                  ? "bg-indigo-600 text-white"
                  : "bg-white/5 hover:bg-white/15 text-white/80"
              }`}
              title="Fit to screen (0)"
            >
              Fit Screen
            </button>
            <button
              type="button"
              onClick={() =>
                setLightbox((s) => ({
                  ...s,
                  actualSize: !s.actualSize,
                  zoom: 1,
                }))
              }
              className={`px-2.5 py-0.5 rounded transition ${
                lightbox.actualSize
                  ? "bg-indigo-600 text-white"
                  : "bg-white/5 hover:bg-white/15 text-white/80"
              }`}
              title="Toggle Native 1:1 Pixel Resolution (1)"
            >
              Actual Size (1:1)
            </button>

            <span className="text-white/20 hidden sm:inline">|</span>
            <button
              type="button"
              onClick={() => setLightbox((s) => ({ ...s, open: false }))}
              className="text-white/60 hover:text-white px-1.5 py-0.5"
            >
              Esc ✕
            </button>
          </div>
        </div>
      )}

      {/* TEMPLATE MANAGER & DEFAULT AUTO-POPULATE ASSIGNMENT MODAL */}
      {newTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-border/80 bg-card p-5 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-indigo-400" />
                <span>Template Manager &amp; Default Auto-Population</span>
              </h4>
              <button
                type="button"
                onClick={() => {
                  setNewTemplateModal(false);
                  setEditingTemplateId(null);
                  setNewTemplateName("");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 1. CREATE OR UPDATE TEMPLATE FROM CURRENT EDITOR */}
            <div className="space-y-2 rounded-lg border border-border/50 bg-[#0d0f14] p-3">
              <div className="text-[11px] font-semibold text-foreground">
                {editingTemplateId
                  ? "Editing Template (saves current editor content into this template)"
                  : "Save Current Editor Layout as New Template"}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Template name (e.g., Weekly Multi-Asset Forecast, Daily Session Log)..."
                  className="h-8 flex-1 rounded-lg border border-border/70 bg-[#141722] px-3 text-xs text-foreground outline-none focus:border-indigo-500"
                />
                {editingTemplateId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTemplateId(null);
                      setNewTemplateName("");
                    }}
                    className="rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveCustomTemplate}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1 text-xs font-semibold text-white transition"
                >
                  {editingTemplateId ? "Update Template" : "Save New Template"}
                </button>
              </div>
            </div>

            {/* 2. EXISTING TEMPLATES LIST (LOAD / EDIT / OVERWRITE / DELETE) */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Saved Templates ({templates.length}) — Click "Load" to edit in workspace, then "Overwrite"
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 bg-[#0d0f14] px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-foreground truncate max-w-[240px]">
                      {t.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (contentRef.current) {
                            contentRef.current.innerHTML = t.html;
                            emitChange();
                          }
                          setEditingTemplateId(t.id);
                          setNewTemplateName(t.name);
                        }}
                        className="rounded border border-border/60 bg-secondary/50 hover:bg-secondary px-2 py-0.5 text-[11px] text-foreground"
                        title="Load this template into the editor to modify it"
                      >
                        Load into Editor
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTemplateId(t.id);
                          setNewTemplateName(t.name);
                        }}
                        className="rounded border border-border/60 bg-secondary/50 hover:bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateTemplateHtmlFromEditor(t.id)}
                        className="rounded border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-300"
                        title="Overwrite this template with current editor blocks"
                      >
                        Overwrite with Editor
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="rounded bg-rose-500/15 hover:bg-rose-500/25 p-1 text-rose-400"
                        title="Delete template"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. DEFAULT AUTO-POPULATE ASSIGNMENT PER JOURNAL PERIOD & TAB */}
            <div className="space-y-2 border-t border-border/50 pt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Default Auto-Populate Templates (Used when creating journals 5 days in advance)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                {(
                  [
                    { key: "day_prep", label: "Daily — Session Notes (Prep)" },
                    { key: "day_review", label: "Daily — End-of-Day Review" },
                    { key: "week_prep", label: "Weekly — Synthesis & Forecast" },
                    { key: "week_review", label: "Weekly — End-of-Week Review" },
                    { key: "month_prep", label: "Monthly — Macro Plan" },
                    { key: "month_review", label: "Monthly — Review" },
                    { key: "quarter_prep", label: "Quarterly — Strategy Plan" },
                    { key: "quarter_review", label: "Quarterly — Review" },
                    { key: "year_prep", label: "Yearly — System Plan" },
                    { key: "year_review", label: "Yearly — Annual Review" },
                  ] as const
                ).map((slot) => (
                  <div
                    key={slot.key}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-[#0d0f14] px-2.5 py-1.5"
                  >
                    <span className="text-[11px] text-muted-foreground truncate">
                      {slot.label}
                    </span>
                    <select
                      value={defaultAssignments[slot.key] || "none"}
                      onChange={(e) => {
                        const nextDefaults = {
                          ...defaultAssignments,
                          [slot.key]: e.target.value,
                        };
                        persistTemplatesAndDefaults(templates, nextDefaults);
                      }}
                      className="rounded border border-border/60 bg-[#181b26] px-2 py-1 text-[11px] text-foreground max-w-[165px]"
                    >
                      <option value="none">— Blank —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={() => setNewTemplateModal(false)}
                className="rounded-lg bg-secondary px-4 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/80"
              >
                Done
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
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline">$1</a>'
    )
    .replace(
      /(^|[\s>])(https?:\/\/[^\s<]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline">$2</a>'
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

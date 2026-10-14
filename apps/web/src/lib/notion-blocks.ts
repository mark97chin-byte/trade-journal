export type NotionColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "gray_background"
  | "brown_background"
  | "orange_background"
  | "yellow_background"
  | "green_background"
  | "blue_background"
  | "purple_background"
  | "pink_background"
  | "red_background";

export const NOTION_TEXT_COLORS: {
  id: NotionColor;
  label: string;
  hex: string;
}[] = [
  { id: "default", label: "Default", hex: "#f1f5f9" },
  { id: "gray", label: "Gray", hex: "#94a3b8" },
  { id: "brown", label: "Brown", hex: "#d6a27e" },
  { id: "orange", label: "Orange", hex: "#fb923c" },
  { id: "yellow", label: "Yellow", hex: "#facc15" },
  { id: "green", label: "Green", hex: "#34d399" },
  { id: "blue", label: "Blue", hex: "#60a5fa" },
  { id: "purple", label: "Purple", hex: "#c084fc" },
  { id: "pink", label: "Pink", hex: "#f472b6" },
  { id: "red", label: "Red", hex: "#f87171" },
];

export const NOTION_BG_COLORS: {
  id: NotionColor;
  label: string;
  rgba: string;
  border: string;
}[] = [
  { id: "default", label: "Default", rgba: "transparent", border: "rgba(255,255,255,0.12)" },
  { id: "gray_background", label: "Gray background", rgba: "rgba(148, 163, 184, 0.16)", border: "rgba(148, 163, 184, 0.3)" },
  { id: "brown_background", label: "Brown background", rgba: "rgba(180, 120, 80, 0.20)", border: "rgba(180, 120, 80, 0.35)" },
  { id: "orange_background", label: "Orange background", rgba: "rgba(249, 115, 22, 0.18)", border: "rgba(249, 115, 22, 0.35)" },
  { id: "yellow_background", label: "Yellow background", rgba: "rgba(234, 179, 8, 0.18)", border: "rgba(234, 179, 8, 0.35)" },
  { id: "green_background", label: "Green background", rgba: "rgba(16, 185, 129, 0.18)", border: "rgba(16, 185, 129, 0.35)" },
  { id: "blue_background", label: "Blue background", rgba: "rgba(59, 130, 246, 0.18)", border: "rgba(59, 130, 246, 0.35)" },
  { id: "purple_background", label: "Purple background", rgba: "rgba(168, 85, 247, 0.18)", border: "rgba(168, 85, 247, 0.35)" },
  { id: "pink_background", label: "Pink background", rgba: "rgba(236, 72, 153, 0.18)", border: "rgba(236, 72, 153, 0.35)" },
  { id: "red_background", label: "Red background", rgba: "rgba(239, 68, 68, 0.18)", border: "rgba(239, 68, 68, 0.35)" },
];

export const NOTION_CODE_LANGUAGES = [
  "plain text",
  "javascript",
  "typescript",
  "python",
  "json",
  "sql",
  "bash",
  "html",
  "css",
  "markdown",
];

function escapeHtml(str: string): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Converts a Notion `rich_text` array into RichEditor HTML with full annotations.
 */
export function notionRichTextToHtml(richTexts: any[] | undefined): string {
  if (!Array.isArray(richTexts) || richTexts.length === 0) return "";

  return richTexts
    .map((rt) => {
      if (!rt) return "";

      if (rt.type === "equation") {
        const expr = escapeHtml(rt.equation?.expression ?? rt.plain_text ?? "");
        return `<span class="tz-inline-equation" data-notion-type="inline_equation" data-expression="${expr}">∑ ${expr}</span>`;
      }

      let html = escapeHtml(rt.plain_text ?? rt.text?.content ?? "").replace(/\n/g, "<br/>");
      const ann = rt.annotations ?? {};

      if (ann.code) html = `<code class="tz-inline-code">${html}</code>`;
      if (ann.bold) html = `<strong>${html}</strong>`;
      if (ann.italic) html = `<em>${html}</em>`;
      if (ann.underline) html = `<u>${html}</u>`;
      if (ann.strikethrough) html = `<s>${html}</s>`;

      if (ann.color && ann.color !== "default") {
        html = `<span class="tz-color-${escapeHtml(ann.color)}" data-notion-color="${escapeHtml(ann.color)}">${html}</span>`;
      }

      const href = rt.href ?? rt.text?.link?.url;
      if (href) {
        html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">${html}</a>`;
      }

      return html;
    })
    .join("");
}

/**
 * Converts an array of Notion API blocks (including nested children) into RichEditor HTML.
 * Never throws on unknown or unsupported block types.
 */
export function notionBlocksToHtml(blocks: any[] | undefined): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";

  const out: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (!block || !block.type) {
      i++;
      continue;
    }

    // Group consecutive bulleted_list_item or numbered_list_item into <ul> / <ol>
    if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const listType = block.type;
      const tag = listType === "bulleted_list_item" ? "ul" : "ol";
      const items: string[] = [];

      while (i < blocks.length && blocks[i]?.type === listType) {
        const b = blocks[i];
        const data = b[listType] ?? {};
        const colorAttr =
          data.color && data.color !== "default"
            ? ` class="tz-color-${escapeHtml(data.color)}" data-notion-color="${escapeHtml(data.color)}"`
            : "";
        const childrenHtml = b.children ? notionBlocksToHtml(b.children) : "";
        items.push(
          `<li data-notion-id="${escapeHtml(b.id ?? "")}"${colorAttr}>${notionRichTextToHtml(
            data.rich_text
          )}${childrenHtml}</li>`
        );
        i++;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    out.push(singleNotionBlockToHtml(block));
    i++;
  }

  return out.join("\n");
}

function singleNotionBlockToHtml(block: any): string {
  const type: string = block.type;
  const idAttr = block.id ? ` data-notion-id="${escapeHtml(block.id)}"` : "";
  const data = block[type] ?? {};
  const color: string = data.color ?? "default";
  const colorClass = color !== "default" ? ` tz-color-${escapeHtml(color)}` : "";
  const colorAttr = color !== "default" ? ` data-notion-color="${escapeHtml(color)}"` : "";
  const childrenHtml = Array.isArray(block.children) ? notionBlocksToHtml(block.children) : "";

  switch (type) {
    case "paragraph": {
      const inner = notionRichTextToHtml(data.rich_text) || "<br/>";
      return `<p class="tz-paragraph${colorClass}" data-notion-type="paragraph"${idAttr}${colorAttr}>${inner}${childrenHtml}</p>`;
    }

    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = type === "heading_1" ? "1" : type === "heading_2" ? "2" : "3";
      const inner = notionRichTextToHtml(data.rich_text) || `Heading ${level}`;
      if (data.is_toggleable) {
        return `
          <div class="tz-toggle tz-toggle-h${level}${colorClass}" data-notion-type="${type}" data-toggle-type="${type}" data-open="true"${idAttr}${colorAttr}>
            <div class="tz-toggle-header">
              <span class="tz-toggle-btn" contenteditable="false">▾</span>
              <div class="tz-toggle-title">${inner}</div>
            </div>
            <div class="tz-toggle-body">${childrenHtml || "<p><br/></p>"}</div>
          </div>
        `;
      }
      return `<h${level} class="tz-heading${colorClass}" data-notion-type="${type}"${idAttr}${colorAttr}>${inner}</h${level}>`;
    }

    case "toggle": {
      const inner = notionRichTextToHtml(data.rich_text) || "Toggle";
      return `
        <div class="tz-toggle${colorClass}" data-notion-type="toggle" data-toggle-type="toggle" data-open="true"${idAttr}${colorAttr}>
          <div class="tz-toggle-header">
            <span class="tz-toggle-btn" contenteditable="false">▾</span>
            <div class="tz-toggle-title">${inner}</div>
          </div>
          <div class="tz-toggle-body">${childrenHtml || "<p><br/></p>"}</div>
        </div>
      `;
    }

    case "to_do": {
      const checked = Boolean(data.checked);
      const inner = notionRichTextToHtml(data.rich_text);
      return `
        <div class="tz-check-row${colorClass}" data-notion-type="to_do"${idAttr}${colorAttr}>
          <input type="checkbox" class="tz-inline-checkbox"${checked ? ' checked="checked"' : ""} />
          <div class="tz-check-text">${inner}${childrenHtml}</div>
        </div>
      `;
    }

    case "quote": {
      const inner = notionRichTextToHtml(data.rich_text);
      return `<blockquote class="tz-quote${colorClass}" data-notion-type="quote"${idAttr}${colorAttr}><div>${inner}</div>${childrenHtml}</blockquote>`;
    }

    case "callout": {
      const iconEmoji =
        data.icon?.type === "emoji"
          ? data.icon.emoji
          : "💡";
      const bgColor = color !== "default" ? color : "blue_background";
      const inner = notionRichTextToHtml(data.rich_text);
      return `
        <div class="tz-callout tz-color-${escapeHtml(bgColor)}" data-notion-type="callout" data-notion-color="${escapeHtml(bgColor)}" data-icon="${escapeHtml(iconEmoji)}"${idAttr}>
          <span class="tz-callout-icon" contenteditable="false" title="Click to change icon">${escapeHtml(iconEmoji)}</span>
          <div class="tz-callout-content"><div>${inner}</div>${childrenHtml}</div>
        </div>
      `;
    }

    case "divider":
      return `<hr class="tz-divider" data-notion-type="divider"${idAttr} />`;

    case "code": {
      const lang = escapeHtml(data.language || "plain text");
      const codeText = escapeHtml(
        (data.rich_text ?? []).map((r: any) => r.plain_text ?? "").join("")
      );
      const captionHtml = notionRichTextToHtml(data.caption);
      return `
        <div class="tz-code-block" data-notion-type="code" data-language="${lang}"${idAttr}>
          <div class="tz-code-header" contenteditable="false">
            <span class="tz-code-lang">${lang}</span>
          </div>
          <pre><code>${codeText}</code></pre>
          ${captionHtml ? `<div class="tz-block-caption">${captionHtml}</div>` : ""}
        </div>
      `;
    }

    case "column_list": {
      const columns = Array.isArray(block.children) ? block.children : [];
      const colHtml = columns
        .map((col: any) => {
          const colChildren = Array.isArray(col.children)
            ? notionBlocksToHtml(col.children)
            : "<p><br/></p>";
          const ratio = col.column?.width_ratio
            ? ` style="flex: ${Number(col.column.width_ratio)}"`
            : "";
          return `<div class="tz-column" data-notion-type="column"${
            col.id ? ` data-notion-id="${escapeHtml(col.id)}"` : ""
          }${ratio}>${colChildren}</div>`;
        })
        .join("");
      return `<div class="tz-column-list" data-notion-type="column_list" data-columns="${
        columns.length || 2
      }"${idAttr}>${colHtml}</div>`;
    }

    case "table": {
      const hasColHeader = Boolean(data.has_column_header);
      const rows = Array.isArray(block.children) ? block.children : [];
      const rowsHtml = rows
        .map((row: any, rIdx: number) => {
          const cells: any[][] = row.table_row?.cells ?? [];
          const cellTag = hasColHeader && rIdx === 0 ? "th" : "td";
          const cellsHtml = cells
            .map((cell) => `<${cellTag}>${notionRichTextToHtml(cell)}</${cellTag}>`)
            .join("");
          return `<tr${row.id ? ` data-notion-id="${escapeHtml(row.id)}"` : ""}>${cellsHtml}</tr>`;
        })
        .join("");
      return `<table class="tz-table" data-notion-type="table"${idAttr}><tbody>${rowsHtml}</tbody></table>`;
    }

    case "image": {
      const url =
        data.localUrl ??
        data.external?.url ??
        data.file?.url ??
        "";
      const caption = notionRichTextToHtml(data.caption);
      return `
        <figure class="tz-figure" data-notion-type="image"${idAttr}>
          <img src="${escapeHtml(url)}" alt="Notion image" class="tz-editor-img" style="max-width: 100%; width: 100%; border-radius: 8px; margin: 6px 0;" />
          ${caption ? `<figcaption class="tz-block-caption">${caption}</figcaption>` : ""}
        </figure>
      `;
    }

    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = escapeHtml(data.url ?? "");
      const caption = notionRichTextToHtml(data.caption);
      return `
        <div class="tz-bookmark" data-notion-type="${type}" data-url="${url}"${idAttr}>
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="tz-bookmark-link" contenteditable="false">
            🔗 ${url || "External link"}
          </a>
          <div class="tz-bookmark-caption">${caption || "Bookmark note"}</div>
        </div>
      `;
    }

    case "video":
    case "audio":
    case "file":
    case "pdf": {
      const url = escapeHtml(
        data.external?.url ?? data.file?.url ?? ""
      );
      const caption = notionRichTextToHtml(data.caption) || data.name || type.toUpperCase();
      return `
        <div class="tz-media-block" data-notion-type="${type}" data-url="${url}"${idAttr}>
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">
            📎 [${type.toUpperCase()}] ${caption}
          </a>
        </div>
      `;
    }

    case "equation": {
      const expr = escapeHtml(data.expression ?? "");
      return `
        <div class="tz-equation" data-notion-type="equation" data-expression="${expr}"${idAttr}>
          <span class="tz-equation-symbol" contenteditable="false">∑</span>
          <code class="tz-equation-code">${expr}</code>
        </div>
      `;
    }

    case "synced_block": {
      return `
        <div class="tz-synced-block" data-notion-type="synced_block"${idAttr}>
          ${childrenHtml || "<p><br/></p>"}
        </div>
      `;
    }

    case "table_of_contents":
    case "breadcrumb":
    case "child_page":
    case "child_database":
    default: {
      const label =
        data.title ??
        type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return `
        <div class="tz-system-block" data-notion-type="${escapeHtml(type)}"${idAttr} contenteditable="false">
          <span>📄 Notion ${escapeHtml(type)}: ${escapeHtml(label)}</span>
        </div>
      `;
    }
  }
}

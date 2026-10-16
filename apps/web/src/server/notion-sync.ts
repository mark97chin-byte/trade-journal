import { parse, HTMLElement, Node } from "node-html-parser";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db, attachments } from "@/db";

const NOTION_VERSION = "2022-06-28";

export function getNotionConfig(periodType: "day" | "week" | "month" | "quarter" | "year" | "trade") {
  const token = process.env.NOTION_TOKEN || "";
  let databaseId = "";

  if (periodType === "trade") {
    databaseId = process.env.NOTION_TRADES_DATABASE_ID || process.env.NOTION_DATABASE_ID || "";
  } else if (periodType === "day") {
    databaseId = process.env.NOTION_DAILY_DATABASE_ID || process.env.NOTION_JOURNAL_DATABASE_ID || process.env.NOTION_DATABASE_ID || "";
  } else {
    databaseId = process.env.NOTION_PERIODIC_DATABASE_ID || process.env.NOTION_JOURNAL_DATABASE_ID || process.env.NOTION_DATABASE_ID || "";
  }

  return { token, databaseId: databaseId.replace(/-/g, "") };
}

async function notionFetch(endpoint: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Notion API (${res.status}) on ${endpoint}: ${errText.slice(0, 300)}`);
  }
  return res.json();
}

function searchFileRecursive(dir: string, pattern: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
      const found = searchFileRecursive(fullPath, pattern);
      if (found) return found;
    } else if (entry.name.includes(pattern)) {
      return fullPath;
    }
  }
  return null;
}

// 3-Tier Local Attachment Binary Resolver
async function getAttachmentBuffer(attId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  try {
    const row = db.select().from(attachments).where(eq(attachments.id, attId)).get() as any;
    if (row) {
      for (const field of ["data", "blob", "content", "bytes", "buffer"]) {
        if (row[field] && Buffer.isBuffer(row[field])) {
          return {
            buffer: row[field],
            mimeType: row.mimeType || row.mime_type || "image/webp",
            fileName: row.filename || row.fileName || `chart-${attId}.webp`,
          };
        }
      }

      const explicitPath = row.filePath || row.file_path || row.path || row.filename || row.fileName;
      if (explicitPath && typeof explicitPath === "string") {
        const rootCandidates = [
          process.cwd(),
          path.join(process.cwd(), ".."),
          path.join(process.cwd(), "apps", "web"),
        ];
        for (const root of rootCandidates) {
          const direct = path.isAbsolute(explicitPath) ? explicitPath : path.join(root, explicitPath);
          if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
            return {
              buffer: fs.readFileSync(direct),
              mimeType: row.mimeType || row.mime_type || "image/webp",
              fileName: path.basename(direct),
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn("DB attachment lookup exception:", err);
  }

  const candidateRoots = [
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "apps", "web", "data"),
    path.join(process.cwd(), "..", "data"),
    path.join(process.cwd(), "public"),
  ];

  for (const rootDir of candidateRoots) {
    const matched = searchFileRecursive(rootDir, attId);
    if (matched) {
      return {
        buffer: fs.readFileSync(matched),
        mimeType: matched.endsWith(".png") ? "image/png" : matched.endsWith(".jpg") ? "image/jpeg" : "image/webp",
        fileName: path.basename(matched),
      };
    }
  }

  const port = process.env.PORT || "3000";
  const internalUrls = [
    `http://127.0.0.1:${port}/api/attachments/${attId}`,
    `http://localhost:${port}/api/attachments/${attId}`,
  ];

  for (const url of internalUrls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "NotionSync/1.0" } });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 0) {
          const mime = res.headers.get("content-type") || "image/webp";
          return {
            buffer: Buffer.from(arrayBuf),
            mimeType: mime,
            fileName: `${attId}.webp`,
          };
        }
      }
    } catch {
      // Continue
    }
  }

  return null;
}

// Cache Notion file_upload IDs (reusable across attachments within Notion's 1-hour window or permanently once attached)
const notionFileUploadCache = new Map<string, string>();

// Upload binary file directly into Notion's private S3 storage via /v1/file_uploads
async function uploadToNotionNativeStorage(attId: string, token: string): Promise<string | null> {
  if (!token) return null;
  if (notionFileUploadCache.has(attId)) {
    return notionFileUploadCache.get(attId)!;
  }

  const fileData = await getAttachmentBuffer(attId);
  if (!fileData) {
    console.warn(`[Notion Native Upload] Could not locate local attachment for ID: ${attId}`);
    return null;
  }

  try {
    // Step 1: Create a File Upload object in Notion
    const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "single_part",
        filename: fileData.fileName,
        content_type: fileData.mimeType,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`[Notion Native Upload] Step 1 create failed (${createRes.status}):`, errText);
      return null;
    }

    const uploadObj = await createRes.json();
    const fileUploadId = uploadObj.id;
    if (!fileUploadId) return null;

    // Step 2: Transmit binary contents via multipart/form-data to /v1/file_uploads/{id}/send
    // IMPORTANT: Do NOT set Content-Type manually so fetch attaches the multipart boundary automatically!
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileData.buffer)], { type: fileData.mimeType });
    formData.append("file", blob, fileData.fileName);

    const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${fileUploadId}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
      body: formData,
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error(`[Notion Native Upload] Step 2 send failed (${sendRes.status}):`, errText);
      return null;
    }

    console.log(`[Notion Native Upload] Uploaded ${attId} directly to Notion Private Storage (id: ${fileUploadId})`);
    notionFileUploadCache.set(attId, fileUploadId);
    return fileUploadId;
  } catch (err) {
    console.error("[Notion Native Upload] Exception:", err);
    return null;
  }
}

export async function fetchNotionBlocksRecursive(blockId: string, token: string, depth = 0): Promise<any[]> {
  if (depth > 5) return [];
  const data = await notionFetch(`/blocks/${blockId}/children?page_size=100`, token);
  const results = data.results || [];

  await Promise.all(
    results.map(async (block: any) => {
      if (block.has_children) {
        block.children = await fetchNotionBlocksRecursive(block.id, token, depth + 1);
      }
    })
  );

  return results;
}

export async function clearNotionPageBlocks(pageId: string, token: string) {
  try {
    const existing = await notionFetch(`/blocks/${pageId}/children?page_size=100`, token);
    const results = existing.results || [];
    await Promise.all(
      results.map((block: any) =>
        fetch(`https://api.notion.com/v1/blocks/${block.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": NOTION_VERSION,
          },
        })
      )
    );
  } catch (err) {
    console.warn("Could not clear previous Notion blocks:", err);
  }
}

function richTextToHtml(richTextArr: any[] = []): string {
  if (!richTextArr || !richTextArr.length) return "";
  return richTextArr
    .map((rt) => {
      let text = (rt.plain_text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const ann = rt.annotations || {};
      if (ann.code) text = `<code class="tz-inline-code">${text}</code>`;
      if (ann.bold) text = `<strong>${text}</strong>`;
      if (ann.italic) text = `<em>${text}</em>`;
      if (ann.underline) text = `<u>${text}</u>`;
      if (ann.strikethrough) text = `<s>${text}</s>`;
      if (ann.color && ann.color !== "default") {
        text = `<span class="tz-color-${ann.color}">${text}</span>`;
      }
      if (rt.href) {
        text = `<a href="${rt.href}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">${text}</a>`;
      }
      return text;
    })
    .join("");
}

export function notionBlocksToHtml(blocks: any[]): string {
  if (!blocks || !blocks.length) return "";
  const out: string[] = [];

  for (const b of blocks) {
    const type = b.type;
    const data = b[type] || {};
    const color = data.color && data.color !== "default" ? data.color : "";
    const colorClass = color ? ` tz-color-${color}` : "";
    const colorAttr = color ? ` data-notion-color="${color}"` : "";
    const textHtml = richTextToHtml(data.rich_text);
    const childrenHtml = b.children ? notionBlocksToHtml(b.children) : "";

    if (type === "paragraph") {
      if (color && color.endsWith("_background")) {
        out.push(
          `<div class="tz-banner${colorClass}" data-notion-type="paragraph"${colorAttr}>${textHtml || "<br/>"}</div>`
        );
      } else {
        out.push(`<p class="${colorClass.trim()}"${colorAttr}>${textHtml || "<br/>"}</p>`);
      }
    } else if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
      const level = type.slice(-1);
      if (data.is_toggleable || (b.children && b.children.length > 0)) {
        out.push(`
          <div class="tz-toggle tz-toggle-h${level}${colorClass}" data-notion-type="${type}" data-toggle-type="${type}" data-open="true"${colorAttr}>
            <div class="tz-toggle-header">
              <span class="tz-toggle-btn" contenteditable="false">▾</span>
              <div class="tz-toggle-title"><strong>${textHtml}</strong></div>
            </div>
            <div class="tz-toggle-body">${childrenHtml || '<p data-placeholder="Empty toggle..."></p>'}</div>
          </div>
        `);
      } else if (color && color.endsWith("_background")) {
        out.push(
          `<div class="tz-banner${colorClass}" data-notion-type="${type}"${colorAttr}><strong>${textHtml}</strong></div>`
        );
      } else {
        out.push(`<h${level} class="${colorClass.trim()}"${colorAttr}>${textHtml}</h${level}>`);
      }
    } else if (type === "toggle") {
      out.push(`
        <div class="tz-toggle${colorClass}" data-notion-type="toggle" data-toggle-type="toggle" data-open="true"${colorAttr}>
          <div class="tz-toggle-header">
            <span class="tz-toggle-btn" contenteditable="false">▾</span>
            <div class="tz-toggle-title"><strong>${textHtml}</strong></div>
          </div>
          <div class="tz-toggle-body">${childrenHtml || '<p data-placeholder="Empty toggle..."></p>'}</div>
        </div>
      `);
    } else if (type === "callout") {
      const emoji = data.icon?.emoji || "";
      if (!emoji) {
        out.push(
          `<div class="tz-banner${colorClass || " tz-color-gray_background"}" data-notion-type="callout"${colorAttr}><strong>${textHtml}</strong>${childrenHtml}</div>`
        );
      } else {
        out.push(`
          <div class="tz-callout${colorClass || " tz-color-blue_background"}" data-notion-type="callout"${colorAttr} data-icon="${emoji}">
            <span class="tz-callout-icon" contenteditable="false">${emoji}</span>
            <div class="tz-callout-content"><div>${textHtml}</div>${childrenHtml}</div>
          </div>
        `);
      }
    } else if (type === "quote") {
      out.push(
        `<blockquote class="tz-quote${colorClass}" data-notion-type="quote"${colorAttr}><div data-placeholder="Empty quote">${textHtml}</div>${childrenHtml}</blockquote>`
      );
    } else if (type === "to_do") {
      const checkedAttr = data.checked ? ' checked="checked"' : "";
      out.push(`
        <div class="tz-check-row${colorClass}" data-notion-type="to_do"${colorAttr}>
          <input type="checkbox" class="tz-inline-checkbox"${checkedAttr} />
          <div class="tz-check-text">${textHtml}</div>
        </div>
      `);
    } else if (type === "bulleted_list_item") {
      out.push(`<ul><li>${textHtml}${childrenHtml}</li></ul>`);
    } else if (type === "numbered_list_item") {
      out.push(`<ol><li>${textHtml}${childrenHtml}</li></ol>`);
    } else if (type === "divider") {
      out.push(`<hr class="tz-divider" data-notion-type="divider" />`);
    } else if (type === "column_list") {
      const cols = b.children || [];
      const colsHtml = cols
        .map((col: any) => {
          const colInner = col.children ? notionBlocksToHtml(col.children) : '<p data-placeholder="Column..."></p>';
          return `<div class="tz-column" data-notion-type="column">${colInner}</div>`;
        })
        .join("");
      out.push(
        `<div class="tz-column-list" data-notion-type="column_list" data-columns="${cols.length || 2}">${colsHtml}</div>`
      );
    } else if (type === "image") {
      const url = data.file?.url || data.external?.url || "";
      if (url) {
        out.push(`
          <figure class="tz-figure" data-notion-type="image">
            <img src="${url}" alt="Notion chart" class="tz-editor-img" style="max-width: 100%; width: 100%; border-radius: 8px; margin: 6px 0;" />
          </figure>
        `);
      }
    }
  }

  return out.join("\n");
}

function toRichText(text: string): any[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return [{ type: "text", text: { content: clean.slice(0, 1950) } }];
}

function findDirectChildByClass(parent: HTMLElement, className: string): HTMLElement | null {
  for (const child of parent.childNodes) {
    if (child.nodeType === 1 && (child as HTMLElement).classList.contains(className)) {
      return child as HTMLElement;
    }
  }
  return null;
}

function findDirectChildrenByClass(parent: HTMLElement, className: string): HTMLElement[] {
  const matches: HTMLElement[] = [];
  for (const child of parent.childNodes) {
    if (child.nodeType === 1 && (child as HTMLElement).classList.contains(className)) {
      matches.push(child as HTMLElement);
    }
  }
  return matches;
}

export async function editorHtmlToNotionTree(html: string, token = process.env.NOTION_TOKEN || ""): Promise<any[]> {
  if (!html || !html.trim()) return [];
  const root = parse(html);

  async function parseNodes(nodes: Node[]): Promise<any[]> {
    const list: any[] = [];
    for (const node of nodes) {
      const parsed = await parseSingleNode(node);
      if (Array.isArray(parsed)) {
        list.push(...parsed);
      } else if (parsed) {
        list.push(parsed);
      }
    }
    return list;
  }

  async function parseSingleNode(node: Node): Promise<any | any[] | null> {
    if (node.nodeType === 3) {
      const text = node.text?.trim();
      if (text) {
        return {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: toRichText(text) },
        };
      }
      return null;
    }

    if (node.nodeType !== 1) return null;
    const el = node as HTMLElement;
    const tag = el.tagName?.toUpperCase();

    if (tag === "STYLE" || tag === "SCRIPT" || tag === "BUTTON" || el.classList.contains("tz-add-ticker-btn")) {
      return null;
    }

    if (tag === "HR" || el.classList.contains("tz-divider")) {
      return { object: "block", type: "divider", divider: {} };
    }

    // 2. Image / Figure -> Native Notion Private S3 Upload (/v1/file_uploads)
    if (tag === "FIGURE" || tag === "IMG" || el.classList.contains("tz-figure")) {
      const imgEl = tag === "IMG" ? el : el.querySelector("img");
      if (!imgEl) return null;
      const src = imgEl.getAttribute("src") || "";
      const attId =
        el.getAttribute("data-attachment-id") ||
        (src.includes("/api/attachments/") ? (src.split("/api/attachments/")[1]?.split("?")[0] ?? "") : "");

      if (attId && token) {
        const fileUploadId = await uploadToNotionNativeStorage(attId, token);
        if (fileUploadId) {
          return {
            object: "block",
            type: "image",
            image: {
              type: "file_upload",
              file_upload: { id: fileUploadId },
            },
          };
        }
      }

      if (src.startsWith("https://") || src.startsWith("http://")) {
        return {
          object: "block",
          type: "image",
          image: {
            type: "external",
            external: { url: src },
          },
        };
      }

      return null;
    }

    if (el.classList.contains("tz-banner")) {
      const color = el.getAttribute("data-notion-color") || "gray_background";
      const text = el.text?.trim() || "Section";
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: toRichText(text), color },
      };
    }

    if (el.classList.contains("tz-check-row")) {
      const checkbox = el.querySelector('input[type="checkbox"]');
      const checked = checkbox
        ? checkbox.hasAttribute("checked") || checkbox.getAttribute("checked") === "checked"
        : false;
      const textEl = el.querySelector(".tz-check-text") || el;
      const text = textEl.text?.trim() || "To-do item";
      return {
        object: "block",
        type: "to_do",
        to_do: { rich_text: toRichText(text), checked },
      };
    }

    if (el.classList.contains("tz-callout")) {
      const rawEmoji = el.getAttribute("data-icon") || el.querySelector(".tz-callout-icon")?.text?.trim() || "💡";
      const color = el.getAttribute("data-notion-color") || "blue_background";
      const contentEl = el.querySelector(".tz-callout-content") || el;
      const text = contentEl.text?.trim() || "Note";
      return {
        object: "block",
        type: "callout",
        callout: {
          icon: { type: "emoji", emoji: rawEmoji },
          color,
          rich_text: toRichText(text),
        },
      };
    }

    if (tag === "BLOCKQUOTE" || el.classList.contains("tz-quote")) {
      const text = el.text?.trim() || " ";
      return {
        object: "block",
        type: "quote",
        quote: { rich_text: toRichText(text || " ") },
      };
    }

    if (el.classList.contains("tz-toggle")) {
      const headerEl = findDirectChildByClass(el, "tz-toggle-header");
      const titleEl = headerEl ? findDirectChildByClass(headerEl, "tz-toggle-title") : el.querySelector(".tz-toggle-title");
      const titleText = titleEl?.text?.trim() || "Toggle";

      const bodyEl = findDirectChildByClass(el, "tz-toggle-body");
      const children = bodyEl ? await parseNodes(bodyEl.childNodes) : [];

      const toggleKind = el.getAttribute("data-toggle-type") || el.getAttribute("data-notion-type") || "toggle";
      if (toggleKind === "heading_1" || toggleKind === "heading_2" || toggleKind === "heading_3") {
        return {
          object: "block",
          type: toggleKind,
          [toggleKind]: {
            rich_text: toRichText(titleText),
            is_toggleable: true,
          },
          _children: children,
        };
      }

      return {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: toRichText(titleText),
        },
        _children: children,
      };
    }

    if (el.classList.contains("tz-column-list")) {
      const colEls = findDirectChildrenByClass(el, "tz-column");

      if (colEls.length >= 2) {
        const columns: any[] = [];
        for (const colEl of colEls) {
          const colBlocks = await parseNodes(colEl.childNodes);
          columns.push({
            object: "block",
            type: "column",
            column: {},
            _children:
              colBlocks.length > 0
                ? colBlocks
                : [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }],
          });
        }
        return {
          object: "block",
          type: "column_list",
          column_list: {},
          _children: columns,
        };
      }
    }

    if (tag === "UL" || tag === "OL") {
      const listType = tag === "OL" ? "numbered_list_item" : "bulleted_list_item";
      const items: any[] = [];
      for (const li of el.childNodes) {
        if (li.nodeType === 1 && (li as HTMLElement).tagName?.toUpperCase() === "LI") {
          const t = li.text?.trim();
          if (t) {
            items.push({
              object: "block",
              type: listType,
              [listType]: { rich_text: toRichText(t) },
            });
          }
        }
      }
      return items;
    }

    if (tag === "H1" || tag === "H2" || tag === "H3") {
      const hType = `heading_${tag.charAt(1)}`;
      const t = el.text?.trim();
      if (!t) return null;
      return {
        object: "block",
        type: hType,
        [hType]: { rich_text: toRichText(t) },
      };
    }

    const hasComplexChild = el.querySelector(
      ".tz-toggle, .tz-column-list, .tz-callout, .tz-banner, .tz-check-row, figure, img, ul, ol, blockquote, hr"
    );
    if (hasComplexChild) {
      return await parseNodes(el.childNodes);
    }

    const plain = el.text?.trim();
    if (plain) {
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: toRichText(plain) },
      };
    }

    return null;
  }

  const result = await parseNodes(root.childNodes);
  if (result.length === 0 && root.text?.trim()) {
    result.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: toRichText(root.text.trim()) },
    });
  }
  return result;
}

export async function appendBlocksTreeRecursive(parentId: string, treeNodes: any[], token: string) {
  if (!treeNodes || treeNodes.length === 0) return;

  for (let i = 0; i < treeNodes.length; i += 50) {
    const chunk = treeNodes.slice(i, i + 50);
    const deferredQueue: Array<{ nodeIndex: number; children: any[]; isColumnList?: boolean }> = [];

    const payloadChildren = chunk.map((node, idx) => {
      const clone = { ...node };
      const children = clone._children;
      delete clone._children;

      if (clone.type === "column_list" && Array.isArray(children)) {
        const columnFollowUps: any[][] = [];
        clone.column_list = {
          children: children.map((colNode: any) => {
            const colChildren = colNode._children || [];
            const shallowColChildren = colChildren.map((c: any) => {
              const cClone = { ...c };
              delete cClone._children;
              return cClone;
            });
            columnFollowUps.push(colChildren);

            return {
              object: "block",
              type: "column",
              column: {
                children:
                  shallowColChildren.length > 0
                    ? shallowColChildren.slice(0, 50)
                    : [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }],
              },
            };
          }),
        };
        deferredQueue.push({ nodeIndex: idx, children: columnFollowUps, isColumnList: true });
      } else if (Array.isArray(children) && children.length > 0) {
        deferredQueue.push({ nodeIndex: idx, children, isColumnList: false });
      }

      return clone;
    });

    let resData: any;
    try {
      resData = await notionFetch(`/blocks/${parentId}/children`, token, {
        method: "PATCH",
        body: JSON.stringify({ children: payloadChildren }),
      });
    } catch (err: any) {
      if (err.message && err.message.includes("column_list")) {
        console.warn("[Notion Sync] Nested column_list inside toggle rejected by Notion API; unpacking to sequential blocks");
        const fallbackChildren: any[] = [];
        for (const node of chunk) {
          if (node.type === "column_list" && Array.isArray(node._children)) {
            for (const col of node._children) {
              if (Array.isArray(col._children)) fallbackChildren.push(...col._children);
            }
          } else {
            fallbackChildren.push(node);
          }
        }
        await appendBlocksTreeRecursive(parentId, fallbackChildren, token);
        continue;
      }
      throw err;
    }

    const createdBlocks = resData.results || [];

    for (const item of deferredQueue) {
      const createdParent = createdBlocks[item.nodeIndex];
      if (!createdParent?.id) continue;

      if (item.isColumnList) {
        const colListChildren = await notionFetch(`/blocks/${createdParent.id}/children?page_size=100`, token);
        const createdColumns = colListChildren.results || [];

        for (let cIdx = 0; cIdx < createdColumns.length; cIdx++) {
          const colId = createdColumns[cIdx]?.id;
          const originalColBlocks = item.children[cIdx] || [];
          if (!colId || !originalColBlocks.length) continue;

          const hasNested = originalColBlocks.some((b: any) => Array.isArray(b._children) && b._children.length > 0);
          if (hasNested) {
            const colBlockResults = await notionFetch(`/blocks/${colId}/children?page_size=100`, token);
            const createdInsideCol = colBlockResults.results || [];
            for (let bIdx = 0; bIdx < originalColBlocks.length; bIdx++) {
              const origBlock = originalColBlocks[bIdx];
              const createdBlock = createdInsideCol[bIdx];
              if (origBlock?._children?.length && createdBlock?.id) {
                await appendBlocksTreeRecursive(createdBlock.id, origBlock._children, token);
              }
            }
          }
        }
      } else {
        await appendBlocksTreeRecursive(createdParent.id, item.children, token);
      }
    }
  }
}

export async function findNotionPageInDb(databaseId: string, token: string, slug: string, title: string) {
  const schema = await notionFetch(`/databases/${databaseId}`, token);
  const props = schema.properties || {};

  let titleProp = "Name";
  for (const [k, v] of Object.entries(props)) {
    if ((v as any).type === "title") {
      titleProp = k;
      break;
    }
  }

  const filter =
    "Slug" in props && props["Slug"].type === "rich_text"
      ? { property: "Slug", rich_text: { equals: slug } }
      : { property: titleProp, title: { contains: slug } };

  const queryRes = await notionFetch(`/databases/${databaseId}/query`, token, {
    method: "POST",
    body: JSON.stringify({ filter, page_size: 5 }),
  });

  return {
    page: (queryRes.results || [])[0] || null,
    titleProp,
    availableProps: props,
  };
}

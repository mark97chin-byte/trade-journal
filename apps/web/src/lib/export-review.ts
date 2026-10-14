import { readVizTokens } from "@/components/charts/tokens";

export interface ReviewDocument {
  title: string;
  subtitle?: string;
  lines: string[];
}

export interface ExportFile {
  blob: Blob;
  filename: string;
}

const filename = (title: string) =>
  title.replace(/[^a-z0-9_-]/gi, "-").slice(0, 100) || "journal-review";

/**
 * Repairs notes that were accidentally double-escaped (&lt;p&gt;Notion: &lt;a href=...)
 */
export function repairCorruptedHtml(input: string): string {
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

  // Clean up mangled nested anchor tags around URLs
  s = s.replace(
    /<a\s+href="[^"]*?(https?:\/\/[^"\s<>]+)[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">$1</a>'
  );

  // Remove leftover broken attribute fragments if any
  s = s.replace(/"=""\s*target="_blank"\s*rel="noopener noreferrer"\s*class="text-indigo-400 underline">/gi, "");
  s = s.replace(/<p>\s*<p>/gi, "<p>").replace(/<\/p>\s*<\/p>/gi, "</p>");

  return s;
}

/**
 * Converts RichEditor HTML (toggles, columns, callouts, checklists, tables, links)
 * into clean, structured text lines + extracts embedded image URLs for canvas/PDF rendering.
 */
export function parseRichNoteForExport(rawLines: string[]): {
  cleanLines: string[];
  imageUrls: string[];
} {
  const cleanLines: string[] = [];
  const imageUrls: string[] = [];

  const stripInlineTags = (html: string): string => {
    let t = repairCorruptedHtml(html);

    // Avoid duplicating URL if link text is the URL itself
    t = t.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const cleanLabel = label.replace(/<[^>]+>/g, "").trim();
      if (!cleanLabel || cleanLabel === href) return href;
      return `${cleanLabel} (${href})`;
    });

    t = t
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h1|h2|h3|blockquote|pre|figure|figcaption)>/gi, "\n")
      .replace(/<\/(td|th)>/gi, "  |  ")
      .replace(/<hr[^>]*>/gi, "\n────────────────────────────────────────\n")
      .replace(/<[^>]+>/g, "");

    t = t
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, "&");

    return t;
  };

  for (const rawLine of rawLines) {
    const healed = repairCorruptedHtml(rawLine);

    // Extract any <img src="..."> URLs
    const imgMatches = [...healed.matchAll(/<img\s+[^>]*src="([^"]+)"[^>]*>/gi)];
    for (const m of imgMatches) {
      if (m[1]) imageUrls.push(m[1]);
    }

    // If plain text without HTML tags, keep as-is
    if (!/<\/?[a-z][\s\S]*?>/i.test(healed)) {
      cleanLines.push(healed);
      continue;
    }

    // Use browser DOMParser when available for accurate column/toggle formatting
    if (typeof DOMParser !== "undefined") {
      try {
        const doc = new DOMParser().parseFromString(`<div>${healed}</div>`, "text/html");
        const root = doc.body.firstElementChild as HTMLElement | null;

        const walkNode = (node: Node, indent = ""): string[] => {
          if (node.nodeType === Node.TEXT_NODE) {
            const txt = (node.textContent ?? "").replace(/\s+/g, " ");
            return txt.trim() ? [`${indent}${txt.trim()}`] : [];
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return [];

          const el = node as HTMLElement;
          const tag = el.tagName.toLowerCase();

          if (tag === "style" || tag === "script" || tag === "input") return [];
          if (el.classList.contains("tz-toggle-btn")) return [];

          if (tag === "hr" || el.classList.contains("tz-divider")) {
            return [`${indent}────────────────────────────────────────`];
          }

          // Multi-column layout: format each column clearly
          if (el.classList.contains("tz-column-list")) {
            const cols = Array.from(el.querySelectorAll(":scope > .tz-column"));
            const colTexts = cols.map((col, idx) => {
              const inner = Array.from(col.childNodes)
                .flatMap((c) => walkNode(c, ""))
                .filter(Boolean)
                .join(" · ");
              return inner ? `[Col ${idx + 1}] ${inner}` : "";
            }).filter(Boolean);
            return colTexts.length ? [`${indent}${colTexts.join("   |   ")}`] : [];
          }

          // Toggle block
          if (el.classList.contains("tz-toggle")) {
            const titleEl = el.querySelector(":scope > .tz-toggle-header > .tz-toggle-title");
            const bodyEl = el.querySelector(":scope > .tz-toggle-body");
            const titleTxt = (titleEl?.textContent ?? "").trim();
            const out: string[] = [];
            if (titleTxt) out.push(`${indent}# ${titleTxt}`);
            if (bodyEl) {
              for (const child of Array.from(bodyEl.childNodes)) {
                out.push(...walkNode(child, `${indent}  `));
              }
            }
            return out;
          }

          // Checklist item
          if (el.classList.contains("tz-check-row")) {
            const input = el.querySelector("input[type='checkbox']") as HTMLInputElement | null;
            const checked = input?.hasAttribute("checked") || input?.checked;
            const txt = (el.querySelector(".tz-check-text")?.textContent ?? el.textContent ?? "").trim();
            return txt ? [`${indent}${checked ? "[done]" : "[ ]"} ${txt}`] : [];
          }

          // Callout box
          if (el.classList.contains("tz-callout")) {
            const contentTxt = (el.querySelector(".tz-callout-content")?.textContent ?? el.textContent ?? "").trim();
            return contentTxt ? [`${indent}Note: ${contentTxt}`] : [];
          }

          // Headings
          if (tag === "h1" || tag === "h2" || tag === "h3") {
            const txt = (el.textContent ?? "").trim();
            return txt ? [`${indent}# ${txt}`] : [];
          }

          // List items
          if (tag === "li") {
            const txt = (el.textContent ?? "").trim();
            return txt ? [`${indent}• ${txt}`] : [];
          }

          // Table rows
          if (tag === "tr") {
            const cells = Array.from(el.querySelectorAll("th, td"))
              .map((c) => (c.textContent ?? "").trim())
              .filter(Boolean);
            return cells.length ? [`${indent}${cells.join("  |  ")}`] : [];
          }

          // Blockquote
          if (tag === "blockquote") {
            const txt = (el.textContent ?? "").trim();
            return txt ? [`${indent}"${txt}"`] : [];
          }

          // Paragraph or generic block
          if (tag === "p" || tag === "div" || tag === "pre" || tag === "figure") {
            // Check if it has block children
            const hasBlockChildren = Array.from(el.children).some((c) =>
              /^(DIV|P|UL|OL|TABLE|BLOCKQUOTE|H1|H2|H3|HR|FIGURE)$/i.test(c.tagName)
            );
            if (hasBlockChildren) {
              return Array.from(el.childNodes).flatMap((c) => walkNode(c, indent));
            }
            const rawInner = stripInlineTags(el.innerHTML)
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);
            return rawInner.map((l) => `${indent}${l}`);
          }

          return Array.from(el.childNodes).flatMap((c) => walkNode(c, indent));
        };

        if (root) {
          const extracted = walkNode(root);
          cleanLines.push(...extracted);
          continue;
        }
      } catch {
        // Fallback to regex stripper below
      }
    }

    const fallbackLines = stripInlineTags(healed)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    cleanLines.push(...fallbackLines);
  }

  return { cleanLines, imageUrls };
}

export async function buildReviewPdf(
  doc: ReviewDocument,
  fontBytes: ArrayBuffer | Uint8Array
) {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());

  // Sanitize any emoji or symbol not supported by NotoSans-Regular so PDF export never crashes
  const sanitizeForFont = (text: string): string => {
    return [...text]
      .map((c) => {
        if (/\s/.test(c)) return c;
        const cp = c.codePointAt(0)!;
        if (supported.has(cp)) return c;
        if (c === "▾" || c === "▼") return "v ";
        if (c === "▸" || c === "▶") return "> ";
        if (c === "•") return "- ";
        if (c === "─" || c === "—") return "-";
        return "";
      })
      .join("");
  };

  const { cleanLines } = parseRichNoteForExport(doc.lines);

  pdf.setTitle(sanitizeForFont(doc.title));
  pdf.setCreator("Trade Journal");
  let page = pdf.addPage([595, 842]),
    y = 786;

  const addPage = () => {
    page = pdf.addPage([595, 842]);
    y = 786;
  };

  const draw = (
    rawText: string,
    size: number,
    color = rgb(0.16, 0.19, 0.24)
  ) => {
    const text = sanitizeForFont(rawText);
    const max = 499;
    let line = "";
    for (const char of text) {
      if (font.widthOfTextAtSize(line + char, size) > max && line) {
        if (y < 65) addPage();
        page.drawText(line, { x: 48, y, size, font, color });
        y -= size * 1.55;
        line = "";
      }
      line += char === "\t" ? "  " : char;
    }
    if (y < 65) addPage();
    page.drawText(line || " ", { x: 48, y, size, font, color });
    y -= size * 1.55;
  };

  draw(doc.title, 22);
  if (doc.subtitle) draw(doc.subtitle, 10, rgb(0.4, 0.44, 0.5));
  y -= 14;

  for (const line of cleanLines.flatMap((s) => s.split("\n"))) {
    const heading = /^#{1,6}\s/.test(line);
    const clean = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/^- [x]/gi, "[done]")
      .replace(/^- [ ]/g, "[ ]");
    draw(clean, heading ? 13 : 10);
    if (heading) y -= 4;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Trade Journal  |  ${i + 1} / ${pages.length}`, {
      x: 48,
      y: 30,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    })
  );
  return new Uint8Array(await pdf.save());
}

export async function exportPdf(doc: ReviewDocument) {
  const response = await fetch("/fonts/NotoSans-Regular.ttf");
  if (!response.ok) throw new Error("Could not load the PDF font.");
  const bytes = await buildReviewPdf(doc, await response.arrayBuffer());
  return [
    {
      blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      filename: `${filename(doc.title)}.pdf`,
    },
  ];
}

async function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function exportPng(doc: ReviewDocument) {
  await document.fonts.ready;
  const t = readVizTokens();
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");

  const { cleanLines, imageUrls } = parseRichNoteForExport(doc.lines);

  canvas.width = 1200;
  ctx.font = "24px Arial";
  const lines: string[] = [];
  for (const source of cleanLines.flatMap((s) => s.split("\n"))) {
    const cleanSource = source.replace(/^#{1,6}\s+/, "");
    let line = "";
    for (const char of cleanSource) {
      if (ctx.measureText(line + char).width > 1040 && line) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }

  // Load any embedded chart screenshots so we can draw them on the PNG card
  const loadedImages = (
    await Promise.all(imageUrls.slice(0, 4).map(loadImageElement))
  ).filter((img): img is HTMLImageElement => img !== null);

  const pages = Math.max(1, Math.ceil(lines.length / 55));
  const files: ExportFile[] = [];

  for (let i = 0; i < pages; i++) {
    const chunk = lines.slice(i * 55, (i + 1) * 55);
    const isLastPage = i === pages - 1;

    // Calculate extra height for embedded chart images on the last page
    let imagesTotalHeight = 0;
    const scaledDims: { img: HTMLImageElement; w: number; h: number }[] = [];
    if (isLastPage && loadedImages.length > 0) {
      for (const img of loadedImages) {
        const maxW = 1040;
        const rawW = img.naturalWidth || img.width || 800;
        const rawH = img.naturalHeight || img.height || 450;
        const scale = Math.min(1, maxW / rawW);
        const w = Math.round(rawW * scale);
        const h = Math.round(rawH * scale);
        scaledDims.push({ img, w, h });
        imagesTotalHeight += h + 28;
      }
    }

    canvas.height = Math.max(600, 300 + chunk.length * 38 + imagesTotalHeight);
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = t.brand;
    ctx.fillRect(0, 0, 1200, 8);
    ctx.fillStyle = t.inkMuted;
    ctx.font = "22px Arial";
    ctx.fillText(
      `TRADE JOURNAL${pages > 1 ? ` · ${i + 1}/${pages}` : ""}`,
      80,
      70
    );
    ctx.fillStyle = t.foreground;
    ctx.font = "bold 38px Arial";
    ctx.fillText(doc.title, 80, 130, 1040);
    ctx.fillStyle = t.inkMuted;
    ctx.font = "20px Arial";
    ctx.fillText(doc.subtitle ?? "", 80, 174, 1040);
    ctx.fillStyle = t.foreground;
    ctx.font = "24px Arial";
    chunk.forEach((line, j) => ctx.fillText(line, 80, 244 + j * 38));

    if (isLastPage && scaledDims.length > 0) {
      let imgY = 244 + chunk.length * 38 + 20;
      for (const item of scaledDims) {
        ctx.drawImage(item.img, 80, imgY, item.w, item.h);
        imgY += item.h + 28;
      }
    }

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Image export failed."))),
        "image/png"
      )
    );
    files.push({
      blob,
      filename: `${filename(doc.title)}${pages > 1 ? `-${i + 1}` : ""}.png`,
    });
  }
  return files;
}

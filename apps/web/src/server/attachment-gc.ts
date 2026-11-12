import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

function resolveJournalDbPath(): string {
  const p1 = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  const p2 = path.resolve(process.cwd(), "data", "journal.db");
  return fs.existsSync(p1) ? p1 : p2;
}

function collectAttachmentIdsFromText(text: string | null | undefined, out: Set<string>) {
  if (!text || typeof text !== "string") return;
  // Match /api/attachments/<id> or attachments/<id>
  const regex = /\/api\/attachments\/([a-zA-Z0-9._-]+)|["']attachments\/([a-zA-Z0-9._-]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const rawId = m[1] || m[2];
    if (rawId) {
      const cleanId = rawId.replace(/\.(webp|png|jpg|jpeg|pdf)$/i, "");
      out.add(rawId);
      out.add(cleanId);
    }
  }
}

/**
 * Scans all rich-text / HTML columns across the entire SQLite database and removes:
 *  1) Any attachment in `attachments` whose owner no longer exists, OR
 *  2) Any inline editor/journal/trade/note attachment that is no longer referenced
 *     by any `<img>` or `<a>` tag in the database.
 * Also removes any unreferenced image files in `data/attachments/` on disk.
 */
export function pruneOrphanAttachments(existingDb?: Database.Database): {
  deletedDbRows: number;
  deletedDiskFiles: number;
  freedBytes: number;
} {
  const shouldClose = !existingDb;
  const dbPath = resolveJournalDbPath();
  if (!existingDb && !fs.existsSync(dbPath)) {
    return { deletedDbRows: 0, deletedDiskFiles: 0, freedBytes: 0 };
  }

  const db = existingDb || new Database(dbPath);
  let deletedDbRows = 0;
  let deletedDiskFiles = 0;
  let freedBytes = 0;

  try {
    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name)
    );

    if (!tables.has("attachments")) {
      return { deletedDbRows: 0, deletedDiskFiles: 0, freedBytes: 0 };
    }

    const referencedIds = new Set<string>();
    const validTradeKeys = new Set<string>();
    const validJournalSlugs = new Set<string>();
    const validNoteIds = new Set<string>();
    const validMissedIds = new Set<string>();
    const validPlaybookIds = new Set<string>();

    // 1. Scan trades
    if (tables.has("trades")) {
      const tradeCols = new Set(
        (db.prepare("PRAGMA table_info(trades)").all() as Array<{ name: string }>).map((c) => c.name)
      );
      const selCols = ["key", "notes", ...(tradeCols.has("review_notes") ? ["review_notes"] : [])];
      const rows = db.prepare(`SELECT ${selCols.join(", ")} FROM trades`).all() as any[];
      for (const r of rows) {
        if (r.key) validTradeKeys.add(String(r.key));
        collectAttachmentIdsFromText(r.notes, referencedIds);
        collectAttachmentIdsFromText(r.review_notes, referencedIds);
      }
    }

    // 2. Scan journal_entries
    if (tables.has("journal_entries")) {
      const rows = db
        .prepare("SELECT slug, content, review_content FROM journal_entries")
        .all() as any[];
      for (const r of rows) {
        if (r.slug) {
          validJournalSlugs.add(String(r.slug));
          validJournalSlugs.add(`${r.slug}-review`);
        }
        collectAttachmentIdsFromText(r.content, referencedIds);
        collectAttachmentIdsFromText(r.review_content, referencedIds);
      }
    }

    // 3. Scan journal_days (legacy)
    if (tables.has("journal_days")) {
      const rows = db.prepare("SELECT date, note FROM journal_days").all() as any[];
      for (const r of rows) {
        if (r.date) validJournalSlugs.add(String(r.date));
        collectAttachmentIdsFromText(r.note, referencedIds);
      }
    }

    // 4. Scan notes (Notebook)
    if (tables.has("notes")) {
      const rows = db.prepare("SELECT id, content FROM notes").all() as any[];
      for (const r of rows) {
        if (r.id) validNoteIds.add(String(r.id));
        collectAttachmentIdsFromText(r.content, referencedIds);
      }
    }

    // 5. Scan missed_trades
    if (tables.has("missed_trades")) {
      const mCols = new Set(
        (db.prepare("PRAGMA table_info(missed_trades)").all() as Array<{ name: string }>).map(
          (c) => c.name
        )
      );
      const selCols = ["id", "notes", ...(mCols.has("review_notes") ? ["review_notes"] : [])];
      const rows = db.prepare(`SELECT ${selCols.join(", ")} FROM missed_trades`).all() as any[];
      for (const r of rows) {
        if (r.id) validMissedIds.add(String(r.id));
        collectAttachmentIdsFromText(r.notes, referencedIds);
        collectAttachmentIdsFromText(r.review_notes, referencedIds);
      }
    }

    // 6. Scan playbooks & playbook_notes & templates
    if (tables.has("playbooks")) {
      const rows = db.prepare("SELECT id FROM playbooks").all() as any[];
      for (const r of rows) if (r.id) validPlaybookIds.add(String(r.id));
    }
    if (tables.has("playbook_notes")) {
      const rows = db.prepare("SELECT content FROM playbook_notes").all() as any[];
      for (const r of rows) collectAttachmentIdsFromText(r.content, referencedIds);
    }
    if (tables.has("settings")) {
      const rows = db.prepare("SELECT value FROM settings").all() as any[];
      for (const r of rows) collectAttachmentIdsFromText(r.value, referencedIds);
    }

    // 7. Evaluate all rows in `attachments`
    const allAtts = db
      .prepare("SELECT id, owner_type, owner_id, COALESCE(size, length(data), 0) as bytes FROM attachments")
      .all() as Array<{ id: string; owner_type: string; owner_id: string; bytes: number }>;

    const delStmt = db.prepare("DELETE FROM attachments WHERE id = ?");

    for (const att of allAtts) {
      const cleanId = String(att.id).replace(/\.(webp|png|jpg|jpeg|pdf)$/i, "");
      const isReferencedInHtml = referencedIds.has(att.id) || referencedIds.has(cleanId);
      if (isReferencedInHtml) continue;

      const oType = String(att.owner_type || "").toLowerCase();
      const oId = String(att.owner_id || "");

      // Editor / Journal / Notion-pulled inline images are always referenced in HTML when active.
      // If they are no longer in any HTML, or if their parent record was deleted, delete the orphan!
      let isOrphan = false;
      if (
        ["editor", "day", "week", "month", "quarter", "year", "journal"].includes(oType)
      ) {
        isOrphan = true;
      } else if (oType === "trade" || oType === "trades") {
        const baseKey = oId.replace(/-review$/, "");
        if (!validTradeKeys.has(oId) && !validTradeKeys.has(baseKey)) {
          isOrphan = true;
        } else {
          // Also delete if it was an inline Notion/editor image for this trade that was deleted from notes
          isOrphan = true;
        }
      } else if (oType === "note" || oType === "notes") {
        // Inline images in notes are always referenced in HTML when active; if unreferenced, prune orphan
        isOrphan = true;
      } else if (oType === "missed" || oType === "missed_trade" || oType === "missed_trades") {
        // Inline images in missed_trades are always referenced in notes/review_notes HTML when active; if unreferenced, prune orphan
        isOrphan = true;
      } else if (oType === "playbook" && !validPlaybookIds.has(oId)) {
        isOrphan = true;
      }

      if (isOrphan) {
        delStmt.run(att.id);
        deletedDbRows += 1;
        freedBytes += Number(att.bytes || 0);
      }
    }

    // 8. Also clean up any orphaned image files in disk attachment folders
    const remainingIds = new Set(
      (db.prepare("SELECT id FROM attachments").all() as Array<{ id: string }>).map((r) =>
        String(r.id).replace(/\.(webp|png|jpg|jpeg|pdf)$/i, "")
      )
    );
    for (const refId of referencedIds) {
      remainingIds.add(refId.replace(/\.(webp|png|jpg|jpeg|pdf)$/i, ""));
    }

    const diskDirs = [
      path.join(process.cwd(), "apps", "web", "data", "attachments"),
      path.join(process.cwd(), "data", "attachments"),
    ];
    for (const dir of diskDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const fn of fs.readdirSync(dir)) {
        const fullP = path.join(dir, fn);
        try {
          const st = fs.statSync(fullP);
          if (!st.isFile()) continue;
          const baseId = fn.replace(/\.(webp|png|jpg|jpeg|pdf)$/i, "");
          if (!remainingIds.has(baseId) && !remainingIds.has(fn)) {
            fs.unlinkSync(fullP);
            deletedDiskFiles += 1;
            freedBytes += st.size;
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn("[AttachmentGC] Error pruning orphan attachments:", err);
  } finally {
    if (shouldClose) {
      try {
        db.close();
      } catch {}
    }
  }

  return { deletedDbRows, deletedDiskFiles, freedBytes };
}

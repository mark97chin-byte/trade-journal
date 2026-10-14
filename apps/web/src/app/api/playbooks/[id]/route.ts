import { eq, sql } from "drizzle-orm";
import { db, playbooks, trades, tradeRuleChecks } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newId, nowIso } from "@/server/ids";
import {
  ensurePlaybookTables,
  flattenRuleGroups,
  getPlaybookDetail,
  upsertMetaRow,
  type PlaybookRuleGroup,
} from "@/server/playbooks-store";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const searchParams = new URL(request.url).searchParams;
  const detail = getPlaybookDetail(id, searchParams);
  if (!detail) return bad("Playbook not found", 404);
  return ok(detail);
});

export const PATCH = handler(async (request: Request, { params }: Params) => {
  ensurePlaybookTables();
  const { id } = await params;
  const existing = db.select().from(playbooks).where(eq(playbooks.id, id)).get();
  if (!existing) return bad("Playbook not found", 404);

  const body = (await request.json()) as {
    action?: string;
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    photoUrl?: string;
    tags?: string[];
    archived?: boolean;
    rules?: string[];
    ruleGroups?: PlaybookRuleGroup[];
    noteId?: string;
    title?: string;
    content?: string;
  };

  // Multi-Note Actions
  if (body.action === "create_note") {
    const noteId = newId();
    const now = nowIso();
    const title = body.title?.trim() || "Untitled";
    const content = body.content ?? "";
    db.run(sql`
      INSERT INTO playbook_notes (id, playbook_id, title, content, created_at, updated_at)
      VALUES (${noteId}, ${id}, ${title}, ${content}, ${now}, ${now})
    `);
    return ok(getPlaybookDetail(id));
  }

  if (body.action === "update_note" && body.noteId) {
    const now = nowIso();
    const title = body.title ?? "Untitled";
    const content = body.content ?? "";
    db.run(sql`
      UPDATE playbook_notes
      SET title = ${title}, content = ${content}, updated_at = ${now}
      WHERE id = ${body.noteId} AND playbook_id = ${id}
    `);
    return ok(getPlaybookDetail(id));
  }

  if (body.action === "delete_note" && body.noteId) {
    db.run(sql`
      DELETE FROM playbook_notes
      WHERE id = ${body.noteId} AND playbook_id = ${id}
    `);
    return ok(getPlaybookDetail(id));
  }

  // Standard Playbook & Rule Group Updates
  let nextFlatRules: string[] | undefined = body.rules;
  if (body.ruleGroups) {
    nextFlatRules = flattenRuleGroups(body.ruleGroups);
  }

  db.update(playbooks)
    .set({
      name: body.name !== undefined ? body.name.trim() : existing.name,
      description: body.description !== undefined ? body.description : existing.description,
      rulesJson: nextFlatRules ? JSON.stringify(nextFlatRules) : existing.rulesJson,
    })
    .where(eq(playbooks.id, id))
    .run();

  upsertMetaRow(id, {
    icon: body.icon,
    color: body.color,
    photoUrl: body.photoUrl,
    tags: body.tags,
    ruleGroups: body.ruleGroups,
    archived: body.archived,
  });

  return ok(getPlaybookDetail(id));
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  ensurePlaybookTables();
  const { id } = await params;
  db.transaction((tx) => {
    tx.update(trades).set({ playbookId: null }).where(eq(trades.playbookId, id)).run();
    tx.delete(tradeRuleChecks).where(eq(tradeRuleChecks.playbookId, id)).run();
    tx.delete(playbooks).where(eq(playbooks.id, id)).run();
  });
  db.run(sql`DELETE FROM playbook_meta WHERE playbook_id = ${id}`);
  db.run(sql`DELETE FROM playbook_notes WHERE playbook_id = ${id}`);
  return ok({ deleted: true });
});

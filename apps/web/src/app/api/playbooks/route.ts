import { db, playbooks } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newId, nowIso } from "@/server/ids";
import {
  ensurePlaybookTables,
  flattenRuleGroups,
  getAllPlaybooksEnriched,
  upsertMetaRow,
  type PlaybookRuleGroup,
} from "@/server/playbooks-store";

export const GET = handler((request: Request) => {
  const params = new URL(request.url).searchParams;
  const data = getAllPlaybooksEnriched(params);
  return ok(data);
});

export const POST = handler(async (request: Request) => {
  ensurePlaybookTables();
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    photoUrl?: string;
    tags?: string[];
    rules?: string[];
    ruleGroups?: PlaybookRuleGroup[];
  };

  if (!body.name || !body.name.trim()) return bad("Strategy name is required");

  const id = newId();
  const ruleGroups: PlaybookRuleGroup[] =
    body.ruleGroups && body.ruleGroups.length > 0
      ? body.ruleGroups
      : [
          {
            id: "group-entry",
            name: "Entry criteria",
            rules: (body.rules ?? []).map((text, idx) => ({
              id: `rule-${idx}`,
              text,
              frequency: "Always",
            })),
          },
        ];

  const flatRules = flattenRuleGroups(ruleGroups);

  db.insert(playbooks)
    .values({
      id,
      name: body.name.trim(),
      description: body.description?.trim() ?? "",
      rulesJson: JSON.stringify(flatRules),
      createdAt: nowIso(),
    })
    .run();

  upsertMetaRow(id, {
    icon: body.icon ?? "🚀",
    color: body.color ?? "#6366f1",
    photoUrl: body.photoUrl ?? "",
    tags: body.tags ?? [],
    ruleGroups,
    archived: false,
  });

  return ok({ id });
});

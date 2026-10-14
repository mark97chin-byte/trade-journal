import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { handler, ok } from "@/server/api";
import {
  ensureTagsTables,
  getTagsWithUsage,
  seedDefaultsAndSyncTrades,
  tagCategories,
  tagDefinitions,
} from "@/server/tags-store";

export const GET = handler(async () => {
  const data = getTagsWithUsage();
  return ok(data);
});

export const POST = handler(async (request: Request) => {
  ensureTagsTables();
  const body = await request.json();
  const now = new Date().toISOString();

  if (body.action === "create_category") {
    const name = String(body.name ?? "").trim();
    const color = String(body.color ?? "#94a3b8").trim();
    if (!name) throw new Error("Category name is required");

    const id = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    db.insert(tagCategories)
      .values({ id, name, color, createdAt: now })
      .run();
    return ok(getTagsWithUsage());
  }

  if (body.action === "update_category") {
    const id = String(body.id ?? "");
    const name = String(body.name ?? "").trim();
    const color = String(body.color ?? "#94a3b8").trim();
    if (!id || !name) throw new Error("Category ID and name are required");

    db.update(tagCategories)
      .set({ name, color })
      .where(eq(tagCategories.id, id))
      .run();
    return ok(getTagsWithUsage());
  }

  if (body.action === "delete_categories") {
    const ids: string[] = Array.isArray(body.ids) ? body.ids : [body.id].filter(Boolean);
    if (ids.length > 0) {
      db.update(tagDefinitions)
        .set({ categoryId: null })
        .where(inArray(tagDefinitions.categoryId, ids))
        .run();
      db.delete(tagCategories)
        .where(inArray(tagCategories.id, ids))
        .run();
    }
    return ok(getTagsWithUsage());
  }

  if (body.action === "create_tag") {
    const name = String(body.name ?? "").trim();
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    const description = String(body.description ?? "").trim();
    if (!name) throw new Error("Tag name is required");

    const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    db.insert(tagDefinitions)
      .values({ id, name, categoryId, description, createdAt: now })
      .run();
    return ok(getTagsWithUsage());
  }

  if (body.action === "update_tag") {
    const id = String(body.id ?? "");
    const name = String(body.name ?? "").trim();
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    const description = String(body.description ?? "").trim();
    if (!id || !name) throw new Error("Tag ID and name are required");

    db.update(tagDefinitions)
      .set({ name, categoryId, description })
      .where(eq(tagDefinitions.id, id))
      .run();
    return ok(getTagsWithUsage());
  }

  if (body.action === "delete_tags") {
    const ids: string[] = Array.isArray(body.ids) ? body.ids : [body.id].filter(Boolean);
    if (ids.length > 0) {
      db.delete(tagDefinitions)
        .where(inArray(tagDefinitions.id, ids))
        .run();
    }
    return ok(getTagsWithUsage());
  }

  if (body.action === "reset_tags") {
    seedDefaultsAndSyncTrades();
    return ok(getTagsWithUsage());
  }

  return ok(getTagsWithUsage());
});

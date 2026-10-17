import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db, attachments } from "@/db";
import { handler, ok, bad } from "@/server/api";
type Context = { params: Promise<{ id: string }> };

function findAttachmentOnDisk(id: string): { buffer: Buffer; mimeType: string } | null {
  const cleanId = id.replace(/\.(webp|png|jpg|jpeg)$/i, "");
  const dirs = [
    path.join(process.cwd(), "apps", "web", "data", "attachments"),
    path.join(process.cwd(), "data", "attachments"),
    path.join(process.cwd(), "..", "data", "attachments"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ext of [".webp", ".png", ".jpg", ".jpeg", ""]) {
      const candidate = path.join(dir, `${cleanId}${ext}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const mimeType = candidate.endsWith(".png")
          ? "image/png"
          : candidate.endsWith(".jpg") || candidate.endsWith(".jpeg")
          ? "image/jpeg"
          : "image/webp";
        return { buffer: fs.readFileSync(candidate), mimeType };
      }
    }
  }
  return null;
}

export const GET = handler(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  const a = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!a) return bad("Attachment not found", 404);
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${a.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
});
export const DELETE = handler(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  db.delete(attachments).where(eq(attachments.id, id)).run();
  return ok({ deleted: true });
});

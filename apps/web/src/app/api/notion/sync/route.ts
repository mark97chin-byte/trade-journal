import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, trades, playbooks } from "@/db";

export const dynamic = "force-dynamic";

export async function POST() {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;

    if (!token || !databaseId) {
        return NextResponse.json(
            { error: "NOTION_TOKEN or NOTION_DATABASE_ID is not configured." },
            { status: 500 }
        );
    }

    try {
        const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ page_size: 100 }),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error("[Notion Sync API] Query failed:", errText);
            return NextResponse.json(
                { error: "Failed to query Notion database", details: errText },
                { status: res.status }
            );
        }

        const data = await res.json();
        const pages = data.results ?? [];

        const allPlaybooks = db.select().from(playbooks).all();
        const playbookMap = new Map<string, string>();
        for (const pb of allPlaybooks) {
            const name = pb.title ?? (pb as any).name;
            if (name) playbookMap.set(name.toLowerCase().trim(), pb.id);
            playbookMap.set(pb.id.toLowerCase().trim(), pb.id);
        }

        let updatedCount = 0;

        for (const page of pages) {
            const props = page.properties ?? {};
            const cidProp = props["LuxAlgo ID"]?.rich_text;
            if (!cidProp || !cidProp.length) continue;

            const clusterId = cidProp[0]?.text?.content?.trim();
            if (!clusterId) continue;

            // Rating
            let rating: number | null = null;
            const rProp = props["Rating"];
            if (rProp?.type === "number") {
                rating = rProp.number;
            } else if (rProp?.type === "select" && rProp.select?.name) {
                const digits = rProp.select.name.replace(/\D/g, "");
                if (digits) rating = parseInt(digits, 10);
            }

            // Reviewed
            const reviewed = Boolean(props["Reviewed"]?.checkbox);
            const reviewedAt = reviewed ? new Date().toISOString() : null;

            // Playbook
            let playbookId: string | null = null;
            const pbName = props["Playbook"]?.select?.name?.trim();
            if (pbName) {
                playbookId = playbookMap.get(pbName.toLowerCase()) ?? pbName;
            }

            // Tags & Mistakes
            const tags = (props["Tags"]?.multi_select ?? []).map((t: any) => t.name);
            const mistakes = (props["Mistakes"]?.multi_select ?? []).map((m: any) => m.name);

            // Stop Loss & Profit Target
            const stopLoss = props["Stop Loss"]?.number ?? props["Planned Stop"]?.number ?? null;
            const profitTarget = props["Profit Target"]?.number ?? props["Planned Target"]?.number ?? null;

            const patch: Record<string, any> = {
                notionUrl: page.url ?? null,
                notionPageId: page.id,
                reviewedAt,
            };

            if (rating !== null) patch.rating = rating;
            if (playbookId !== null) patch.playbookId = playbookId;
            if (tags.length > 0) patch.tagsJson = JSON.stringify(tags);
            if (mistakes.length > 0) patch.mistakesJson = JSON.stringify(mistakes);
            if (stopLoss !== null) patch.stopLoss = stopLoss;
            if (profitTarget !== null) patch.profitTarget = profitTarget;

            const result = db
            .update(trades)
            .set(patch)
            .where(eq(trades.key, clusterId))
            .run();

            if (result.changes > 0) {
                updatedCount++;
            }
        }

        return NextResponse.json({
            success: true,
            totalPages: pages.length,
            updatedCount,
        });
    } catch (error: any) {
        console.error("[Notion Sync API Error]", error);
        return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
    }
}

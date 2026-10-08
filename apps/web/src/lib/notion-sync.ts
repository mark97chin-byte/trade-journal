export interface TradeNotionUpdates {
    rating?: number | null;
    reviewed?: boolean;
    tags?: string[];
    mistakes?: string[];
    playbook?: string | null;
    stopLoss?: number | null;
    profitTarget?: number | null;
}

export async function patchNotionTradePage(
    pageId: string,
    updates: TradeNotionUpdates
) {
    const token = process.env.NOTION_TOKEN;
    if (!token) {
        console.error("[Notion Sync] Aborted: NOTION_TOKEN is missing in process.env");
        return;
    }
    if (!pageId) {
        console.error("[Notion Sync] Aborted: Missing pageId");
        return;
    }

    const properties: Record<string, any> = {};

    // Notion Rating is a Select property expecting { select: { name: "1" } } or null
    if (updates.rating !== undefined) {
        properties["Rating"] = updates.rating
        ? { select: { name: String(updates.rating) } }
        : null;
    }

    if (updates.reviewed !== undefined) {
        properties["Reviewed"] = { checkbox: Boolean(updates.reviewed) };
    }

    if (updates.playbook !== undefined) {
        properties["Playbook"] = updates.playbook
        ? { select: { name: updates.playbook } }
        : null;
    }

    if (updates.tags !== undefined) {
        properties["Tags"] = {
            multi_select: updates.tags.map((t) => ({ name: t })),
        };
    }

    if (updates.mistakes !== undefined) {
        properties["Mistakes"] = {
            multi_select: updates.mistakes.map((m) => ({ name: m })),
        };
    }

    if (updates.stopLoss !== undefined) {
        properties["Stop Loss"] = updates.stopLoss != null ? { number: updates.stopLoss } : null;
        properties["Planned Stop"] = updates.stopLoss != null ? { number: updates.stopLoss } : null;
    }

    if (updates.profitTarget !== undefined) {
        properties["Profit Target"] = updates.profitTarget != null ? { number: updates.profitTarget } : null;
        properties["Planned Target"] = updates.profitTarget != null ? { number: updates.profitTarget } : null;
    }

    if (Object.keys(properties).length === 0) return;

    try {
        const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ properties }),
        });

        if (!res.ok) {
            const err = await res.text();
            console.error(`[Notion PATCH Error ${res.status}]`, err);
        } else {
            console.log(`[Notion Sync] Successfully updated Notion page ${pageId}`);
        }
    } catch (error) {
        console.error("[Notion Sync Failed]", error);
    }
}

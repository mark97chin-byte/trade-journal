import { NextRequest, NextResponse } from "next/server";
import {
  getJournalConfig,
  saveJournalConfig,
  autoPopulateUpcomingJournals,
} from "@/server/journal-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const config = getJournalConfig();
    if (url.searchParams.get("autopopulate") === "1") {
      // Trigger non-blocking 5-day rolling Notion + local auto-population
      void autoPopulateUpcomingJournals(5).catch((err) =>
        console.warn("[AutoPopulate] Background warning:", err)
      );
    }
    return NextResponse.json({ ok: true, config });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to load journal config" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const updated = saveJournalConfig(body);
    if (body.triggerAutoPopulate) {
      void autoPopulateUpcomingJournals(5).catch((err) =>
        console.warn("[AutoPopulate] Background warning:", err)
      );
    }
    return NextResponse.json({ ok: true, config: updated });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to save journal config" },
      { status: 500 }
    );
  }
}

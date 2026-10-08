"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { HoverHint } from "./ui/tooltip";

interface SyncNotionButtonProps {
    iconOnly?: boolean;
}

export function SyncNotionButton({ iconOnly = false }: SyncNotionButtonProps) {
    const [syncing, setSyncing] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const router = useRouter();

    const runSync = useCallback(
        async (isAuto = false) => {
            if (syncing) return;
            setSyncing(true);
            if (!isAuto) setStatusMessage(null);

            try {
                const res = await fetch("/api/notion/sync", { method: "POST" });
                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || "Failed to sync");
                }

                // 1. Immediately trigger live re-fetch in all open useApi views (TradeView, Dashboard)
                window.dispatchEvent(new CustomEvent("journal:refresh"));

                // 2. Revalidate Server Components in the route tree
                router.refresh();

                if (!isAuto) {
                    setStatusMessage(`Synced ${data.updatedCount}`);
                    setTimeout(() => setStatusMessage(null), 3500);
                }
            } catch (err: any) {
                console.error("[Sync Notion Error]", err);
                if (!isAuto) {
                    setStatusMessage("Failed");
                    setTimeout(() => setStatusMessage(null), 3500);
                }
            } finally {
                setSyncing(false);
            }
        },
        [syncing, router]
    );

    // Auto-sync whenever you switch back to this browser tab from Notion
    useEffect(() => {
        const handleFocus = () => {
            void runSync(true);
        };
        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, [runSync]);

    const tooltipLabel = syncing
    ? "Syncing from Notion..."
    : statusMessage
    ? `Notion: ${statusMessage}`
    : "Sync from Notion";

    const buttonContent = (
        <Button
        variant="ghost"
        size={iconOnly ? "icon" : "sm"}
        onClick={() => void runSync(false)}
        disabled={syncing}
        className={cn(
            "text-muted-foreground hover:text-foreground transition-all",
            iconOnly ? "h-9 w-9" : "w-full justify-start gap-2 px-2 text-xs font-normal"
        )}
        aria-label="Sync Notion"
        >
        <RefreshCw
        className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-500",
            syncing && "animate-spin text-primary"
        )}
        />
        {!iconOnly && (
            <span className="truncate">
            {syncing ? "Syncing..." : statusMessage ? statusMessage : "Sync Notion"}
            </span>
        )}
        </Button>
    );

    return (
        <HoverHint content={tooltipLabel} side="right">
        {buttonContent}
        </HoverHint>
    );
}

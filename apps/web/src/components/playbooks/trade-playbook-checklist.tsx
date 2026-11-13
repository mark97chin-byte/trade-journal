"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

interface RuleCheckItem {
  id: string;
  rule: string;
  frequency?: string;
  followed: boolean | null;
}

interface RuleCheckGroup {
  id: string;
  name: string;
  rules: RuleCheckItem[];
}

export function TradePlaybookChecklist({
  tradeKey,
  playbookId,
  asCard = false,
  defaultCollapsed = true,
  onUpdated,
}: {
  tradeKey: string;
  playbookId?: string | null;
  asCard?: boolean;
  defaultCollapsed?: boolean;
  onUpdated?: () => void;
}) {
  const [playbookName, setPlaybookName] = useState<string | null>(null);
  const [ruleGroups, setRuleGroups] = useState<RuleCheckGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const fetchRules = async () => {
    if (!tradeKey || !playbookId || playbookId === "none") {
      setPlaybookName(null);
      setRuleGroups([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/trades/${encodeURIComponent(tradeKey)}/rules`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        setPlaybookName(data.name ?? null);

        if (Array.isArray(data.ruleGroups) && data.ruleGroups.length > 0) {
          setRuleGroups(data.ruleGroups);
        } else if (Array.isArray(data.rules) && data.rules.length > 0) {
          setRuleGroups([
            {
              id: "group-default",
              name: "Entry criteria",
              rules: data.rules.map((r: any, idx: number) => ({
                id: `rule-${idx}`,
                rule: r.rule,
                frequency: "Always",
                followed: r.followed ?? null,
              })),
            },
          ]);
        } else {
          setRuleGroups([]);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRules();
  }, [tradeKey, playbookId]);

  const toggleRule = async (ruleText: string, currentFollowed: boolean | null) => {
    const nextFollowed = currentFollowed === true ? false : true;

    setRuleGroups((prev) =>
      prev.map((g) => ({
        ...g,
        rules: g.rules.map((r) =>
          r.rule === ruleText ? { ...r, followed: nextFollowed } : r
        ),
      }))
    );

    await fetch(`/api/trades/${encodeURIComponent(tradeKey)}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule: ruleText, followed: nextFollowed }),
    });

    onUpdated?.();
  };

  const toggleAllRules = async () => {
    const allRules = ruleGroups.flatMap((g) => g.rules);
    if (allRules.length === 0) return;
    const allChecked = allRules.every((r) => r.followed === true);
    const nextState = !allChecked;

    setRuleGroups((prev) =>
      prev.map((g) => ({
        ...g,
        rules: g.rules.map((r) => ({ ...r, followed: nextState })),
      }))
    );

    await Promise.all(
      allRules.map((item) =>
        fetch(`/api/trades/${encodeURIComponent(tradeKey)}/rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule: item.rule, followed: nextState }),
        })
      )
    );

    onUpdated?.();
  };

  if (!playbookId || playbookId === "none") {
    return null;
  }

  const totalRules = ruleGroups.reduce((acc, g) => acc + g.rules.length, 0);
  const followedCount = ruleGroups.reduce(
    (acc, g) => acc + g.rules.filter((r) => r.followed === true).length,
    0
  );

  if (!loading && totalRules === 0) {
    return null;
  }

  const innerContent = (
    <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 space-y-2.5 mt-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-2 text-left text-xs group"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
          )}
          <span className="font-bold text-foreground">
            Strategy Rules Followed ({followedCount} / {totalRules})
          </span>
          {playbookName && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {playbookName}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {!collapsed && totalRules > 0 && (
            <button
              type="button"
              onClick={() => void toggleAllRules()}
              className="text-[11px] underline text-muted-foreground hover:text-foreground"
            >
              {followedCount === totalRules ? "Clear All" : "Check All Rules"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded border border-border/60 bg-background/60 hover:bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {!collapsed && totalRules > 0 && (
        <div className="space-y-2.5 pt-2 border-t border-border/40">
          {ruleGroups.map((group) => {
            if (group.rules.length === 0) return null;
            const isGroupCollapsed = Boolean(collapsedGroups[group.id]);
            const groupFollowed = group.rules.filter((r) => r.followed === true).length;

            return (
              <div
                key={group.id}
                className="rounded-lg border border-border/40 bg-background/40 p-2 space-y-1.5"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedGroups((prev) => ({
                      ...prev,
                      [group.id]: !prev[group.id],
                    }))
                  }
                  className="flex w-full items-center justify-between gap-2 px-1 py-0.5 text-left group"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
                    {isGroupCollapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
                    <span>{group.name}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {groupFollowed}/{group.rules.length}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {isGroupCollapsed ? "Expand" : "Collapse"}
                    </span>
                  </div>
                </button>

                {!isGroupCollapsed && (
                  <div className="space-y-1 pt-0.5">
                    {group.rules.map((item) => {
                      const isChecked = item.followed === true;
                      return (
                        <label
                          key={item.id || item.rule}
                          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-xs transition select-none ${
                            isChecked
                              ? "border-border bg-secondary/70 text-foreground font-medium"
                              : "border-border/50 bg-background text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => void toggleRule(item.rule, item.followed)}
                            />
                            <span className="leading-snug">{item.rule}</span>
                          </div>

                          <span
                            className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${
                              isChecked
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-secondary/60 text-muted-foreground"
                            }`}
                          >
                            {isChecked ? "Followed" : "Unchecked"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (asCard) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Strategy rule review
          </p>
        </CardHeader>
        <CardContent>{innerContent}</CardContent>
      </Card>
    );
  }

  return innerContent;
}

"use client";

import React, { useEffect, useState } from "react";
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
  onUpdated,
}: {
  tradeKey: string;
  playbookId?: string | null;
  asCard?: boolean;
  onUpdated?: () => void;
}) {
  const [playbookName, setPlaybookName] = useState<string | null>(null);
  const [ruleGroups, setRuleGroups] = useState<RuleCheckGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRules = async () => {
    if (!tradeKey) return;
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
    fetchRules();
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

  const totalRules = ruleGroups.reduce((acc, g) => acc + g.rules.length, 0);
  const followedCount = ruleGroups.reduce(
    (acc, g) => acc + g.rules.filter((r) => r.followed === true).length,
    0
  );

  return (
    <Card>
      <CardHeader className="pb-3 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Strategy rule review
        </p>
        {playbookName ? (
          <>
            <h3 className="text-sm font-bold text-foreground">{playbookName}</h3>
            <p className="text-xs text-muted-foreground tabular-nums">
              {followedCount}/{totalRules} rules followed
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {loading ? "Loading rules..." : "Assign a playbook above to review strategy rules."}
          </p>
        )}
      </CardHeader>

      {playbookName && totalRules > 0 && (
        <CardContent className="space-y-4 pt-0">
          {ruleGroups.map((group) => {
            if (group.rules.length === 0) return null;
            return (
              <div key={group.id} className="space-y-1.5">
                {ruleGroups.length > 1 && (
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.name}
                  </div>
                )}

                <div className="divide-y divide-border/30 border-t border-border/30">
                  {group.rules.map((item) => {
                    const isChecked = item.followed === true;
                    return (
                      <label
                        key={item.id || item.rule}
                        className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-xs hover:bg-secondary/20 transition-colors select-none px-1 rounded-xs"
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleRule(item.rule, item.followed)}
                          />
                          <span
                            className={
                              isChecked
                                ? "text-foreground font-medium"
                                : "text-muted-foreground"
                            }
                          >
                            {item.rule}
                          </span>
                        </div>

                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                            isChecked
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-secondary/50 text-muted-foreground"
                          }`}
                        >
                          {isChecked ? "Followed" : "Unchecked"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

"use client";
import { TradePlaybookChecklist } from "@/components/playbooks/trade-playbook-checklist";
import { OptionSelect } from "@/components/ui/option-select";

import { useState } from "react";
import { useApi, postJson } from "@/lib/use-api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { fieldClass } from "@/components/filter-fields";
export function RuleChecklist(props: any) {
  const firstStr =
    props && typeof props === "object"
      ? Object.values(props).find((v) => typeof v === "string")
      : "";
  const tradeKey =
    props?.tradeKey ??
    props?.trade?.key ??
    props?.tradeId ??
    props?.id ??
    firstStr ??
    "";
  const playbookId = props?.playbookId ?? props?.trade?.playbookId ?? null;
  return <TradePlaybookChecklist tradeKey={String(tradeKey)} playbookId={playbookId} asCard />;
}

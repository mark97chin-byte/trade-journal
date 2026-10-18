"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  GripVertical,
  Plus,
  Upload,
  XCircle,
  ChevronDown,
  X,
} from "lucide-react";
import type { PlaybookRuleGroup } from "@/server/playbooks-store";

const PRESET_ICONS = ["🚀", "⚡", "📈", "🎯", "🔥", "💎", "🛡️", "🌊", "🧠", "⚖️"];
const PRESET_STYLE_TAGS = ["Scalping", "Intraday", "Swing", "Futures", "Forex", "Crypto", "Indices"];

interface PlaybookModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (id?: string) => void;
  initialData?: {
    id: string;
    name: string;
    description: string;
    icon: string;
    photoUrl: string;
    tags: string[];
    ruleGroups: PlaybookRuleGroup[];
  } | null;
}

export function PlaybookModal({
  open,
  onClose,
  onSaved,
  initialData,
}: PlaybookModalProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [icon, setIcon] = useState(initialData?.icon ?? "🚀");
  const [photoUrl, setPhotoUrl] = useState(initialData?.photoUrl ?? "");
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? ["Scalping", "Intraday", "Futures"]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [ruleGroups, setRuleGroups] = useState<PlaybookRuleGroup[]>(() =>
    initialData?.ruleGroups && initialData.ruleGroups.length > 0
      ? initialData.ruleGroups
      : [
          {
            id: `group-${Date.now()}`,
            name: "Entry criteria",
            rules: [
              {
                id: `rule-${Date.now()}-1`,
                text: "",
                frequency: "Always",
              },
            ],
          },
        ]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPhotoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const addRuleGroup = () => {
    setRuleGroups((prev) => [
      ...prev,
      {
        id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: "",
        rules: [
          {
            id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            text: "",
            frequency: "Always",
          },
        ],
      },
    ]);
  };

  const removeRuleGroup = (groupId: string) => {
    setRuleGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const updateGroupName = (groupId: string, newName: string) => {
    setRuleGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name: newName } : g))
    );
  };

  const addRuleToGroup = (groupId: string) => {
    setRuleGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              rules: [
                ...g.rules,
                {
                  id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                  text: "",
                  frequency: "Always",
                },
              ],
            }
          : g
      )
    );
  };

  const updateRule = (
    groupId: string,
    ruleId: string,
    patch: Partial<{ text: string; frequency: "Always" | "Sometimes" | "Optional" }>
  ) => {
    setRuleGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              rules: g.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
            }
          : g
      )
    );
  };

  const removeRule = (groupId: string, ruleId: string) => {
    setRuleGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, rules: g.rules.filter((r) => r.id !== ruleId) }
          : g
      )
    );
  };

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);

    const cleanedGroups = ruleGroups
      .map((g) => ({
        ...g,
        name: g.name.trim() || "General rules",
        rules: g.rules.filter((r) => r.text.trim().length > 0),
      }))
      .filter((g) => g.name.length > 0);

    try {
      if (initialData?.id) {
        const res = await fetch(`/api/playbooks/${initialData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            icon,
            photoUrl,
            tags,
            ruleGroups: cleanedGroups,
          }),
        });
        if (res.ok) onSaved(initialData.id);
      } else {
        const res = await fetch("/api/playbooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            icon,
            photoUrl,
            tags,
            ruleGroups: cleanedGroups,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          onSaved(json.data?.id ?? json.id);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-border/70 bg-[#12141a] p-6 text-foreground shadow-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">General info</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Name + Icon Selector */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Name</label>
              <div className="flex items-center gap-2.5">
                <input
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name your trading strategy"
                  className="h-10 flex-1 rounded-lg border border-border/70 bg-[#161822] px-3.5 text-xs text-foreground outline-none focus:border-indigo-500"
                />

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIconPickerOpen(!iconPickerOpen)}
                    className="flex h-10 items-center gap-2 rounded-lg border border-border/70 bg-[#161822] px-3.5 text-xs text-foreground hover:border-foreground/40"
                  >
                    <span className="text-base">{icon}</span>
                    <span className="text-muted-foreground">Icon or color</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>

                  {iconPickerOpen && (
                    <div className="absolute right-0 top-full z-50 mt-1.5 grid w-48 grid-cols-5 gap-1.5 rounded-xl border border-border/80 bg-[#161822] p-2.5 shadow-2xl">
                      {PRESET_ICONS.map((ic) => (
                        <button
                          key={ic}
                          type="button"
                          onClick={() => {
                            setIcon(ic);
                            setIconPickerOpen(false);
                          }}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg text-base hover:bg-secondary/60 ${
                            icon === ic ? "bg-secondary text-foreground border border-border font-semibold shadow-2xs/30 ring-1 ring-indigo-500" : ""
                          }`}
                        >
                          {ic}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add description"
                className="h-10 w-full rounded-lg border border-border/70 bg-[#161822] px-3.5 text-xs text-foreground outline-none focus:border-indigo-500"
              />
            </div>

            {/* Strategy Style Tags */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Strategy tags</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_STYLE_TAGS.map((tg) => {
                  const active = tags.includes(tg);
                  return (
                    <button
                      key={tg}
                      type="button"
                      onClick={() => toggleTag(tg)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-border bg-secondary/70 text-foreground"
                          : "border-border/60 bg-[#161822] text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tg}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Photo Upload */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Photo</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex h-10 w-full cursor-pointer items-center justify-between rounded-lg border border-border/70 bg-[#161822] px-3.5 text-xs text-muted-foreground hover:border-foreground/40"
              >
                <span className="truncate">
                  {photoUrl ? "Cover photo attached (click to change)" : "Upload photo"}
                </span>
                <Upload className="h-4 w-4 shrink-0" />
              </div>
            </div>
          </div>

          {/* Rules & Rule Groups Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">Rules</h3>
                <p className="text-xs text-muted-foreground">
                  Define when a trade should match this setup.
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={addRuleGroup}
                className="bg-secondary text-foreground font-semibold border border-border hover:bg-secondary text-foreground font-semibold border border-border text-xs font-semibold h-8 px-3.5"
              >
                Add rule group
              </Button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
              {ruleGroups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-xl border border-border/50 bg-[#0d0f14] p-3.5 space-y-2.5"
                >
                  {/* Group Name Row */}
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <input
                      type="text"
                      value={group.name}
                      onChange={(e) => updateGroupName(group.id, e.target.value)}
                      placeholder="E.g. Entry criteria, Timeframes, Stop loss..."
                      className="h-9 flex-1 rounded-lg border border-border/70 bg-[#161822] px-3 text-xs font-medium text-foreground outline-none focus:border-indigo-500"
                    />
                    {ruleGroups.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRuleGroup(group.id)}
                        className="text-muted-foreground hover:text-rose-400 p-1"
                        title="Delete rule group"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Rules Inside Group */}
                  <div className="rounded-lg border border-border/30 bg-[#12141a] p-2.5 space-y-2">
                    {group.rules.map((rule) => (
                      <div key={rule.id} className="flex items-center gap-2">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                        <input
                          type="text"
                          value={rule.text}
                          onChange={(e) =>
                            updateRule(group.id, rule.id, { text: e.target.value })
                          }
                          placeholder="(E.g. Trading above VWAP)"
                          className="h-9 flex-1 rounded-lg border border-border/60 bg-[#161822] px-3 text-xs text-foreground outline-none focus:border-indigo-500"
                        />
                        <select
                          value={rule.frequency}
                          onChange={(e) =>
                            updateRule(group.id, rule.id, {
                              frequency: e.target.value as any,
                            })
                          }
                          className="h-9 rounded-lg border border-border/60 bg-[#161822] px-2.5 text-xs text-foreground outline-none"
                        >
                          <option value="Always">Always</option>
                          <option value="Sometimes">Sometimes</option>
                          <option value="Optional">Optional</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeRule(group.id, rule.id)}
                          className="text-muted-foreground hover:text-rose-400 p-1"
                          title="Remove rule"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => addRuleToGroup(group.id)}
                      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add rule</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 border-t border-border/40 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs h-9 px-4"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="bg-secondary text-foreground font-semibold border border-border hover:bg-secondary text-foreground font-semibold border border-border text-xs font-semibold h-9 px-5"
            >
              {saving
                ? "Saving..."
                : initialData
                ? "Save strategy"
                : "Create strategy"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

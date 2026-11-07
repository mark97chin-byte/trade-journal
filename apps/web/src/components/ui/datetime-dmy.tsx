"use client";

import React, { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export function isoToDmyDateTime(iso: string): string {
  if (!iso) return "";
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}, ${m[4]}:${m[5]}`;
}

export function dmyDateTimeToIso(dmy: string): string | null {
  const m = dmy
    .trim()
    .match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[,\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, "0");
  const mm = m[2]!.padStart(2, "0");
  const yyyy = m[3]!;
  const hh = (m[4] ?? "00").padStart(2, "0");
  const min = (m[5] ?? "00").padStart(2, "0");
  const dayNum = Number(dd);
  const monNum = Number(mm);
  if (monNum < 1 || monNum > 12 || dayNum < 1 || dayNum > 31) return null;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function isoToDmyDate(iso: string): string {
  if (!iso) return "";
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function dmyDateToIso(dmy: string): string | null {
  const m = dmy.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, "0");
  const mm = m[2]!.padStart(2, "0");
  const yyyy = m[3]!;
  const dayNum = Number(dd);
  const monNum = Number(mm);
  if (monNum < 1 || monNum > 12 || dayNum < 1 || dayNum > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

const BASE_WRAPPER_CLASSES =
  "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-2xs transition-colors focus-within:ring-1 focus-within:ring-ring";

export const DateTimeInputDMY = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function DateTimeInputDMY(
  { value = "", onChange, className, disabled, placeholder = "dd-mm-yyyy, hh:mm", type: _type, ...rest },
  ref
) {
  const [text, setText] = useState(() => isoToDmyDateTime(String(value ?? "")));
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(isoToDmyDateTime(String(value ?? "")));
  }, [value]);

  const emitChange = (isoVal: string) => {
    if (!onChange) return;
    const synthetic = {
      target: { value: isoVal },
      currentTarget: { value: isoVal },
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(synthetic);
  };

  return (
    <div className={cn(BASE_WRAPPER_CLASSES, disabled && "opacity-50 cursor-not-allowed", className)}>
      <input
        {...rest}
        ref={ref}
        type="text"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            emitChange("");
            return;
          }
          const parsed = dmyDateTimeToIso(next);
          if (parsed) emitChange(parsed);
        }}
        onBlur={() => {
          const parsed = dmyDateTimeToIso(text);
          if (parsed) {
            setText(isoToDmyDateTime(parsed));
          } else if (value) {
            setText(isoToDmyDateTime(String(value)));
          }
        }}
        className="h-full min-w-[125px] flex-1 border-0 bg-transparent p-0 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            try {
              (nativeRef.current as any)?.showPicker?.();
            } catch {
              nativeRef.current?.focus();
            }
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
          title="Open calendar picker"
          tabIndex={-1}
        >
          <Calendar className="h-3.5 w-3.5 shrink-0" />
        </button>
        <input
          ref={nativeRef}
          type="datetime-local"
          value={String(value ?? "").slice(0, 16)}
          disabled={disabled}
          onChange={(e) => {
            const iso = e.target.value;
            setText(isoToDmyDateTime(iso));
            emitChange(iso);
          }}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: "1px",
            height: "1px",
            opacity: 0,
            pointerEvents: "none",
            border: 0,
            padding: 0,
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </div>
  );
});

export const DateInputDMY = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function DateInputDMY(
  { value = "", onChange, className, disabled, placeholder = "dd-mm-yyyy", type: _type, ...rest },
  ref
) {
  const [text, setText] = useState(() => isoToDmyDate(String(value ?? "")));
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(isoToDmyDate(String(value ?? "")));
  }, [value]);

  const emitChange = (isoVal: string) => {
    if (!onChange) return;
    const synthetic = {
      target: { value: isoVal },
      currentTarget: { value: isoVal },
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(synthetic);
  };

  return (
    <div className={cn(BASE_WRAPPER_CLASSES, disabled && "opacity-50 cursor-not-allowed", className)}>
      <input
        {...rest}
        ref={ref}
        type="text"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            emitChange("");
            return;
          }
          const parsed = dmyDateToIso(next);
          if (parsed) emitChange(parsed);
        }}
        onBlur={() => {
          const parsed = dmyDateToIso(text);
          if (parsed) {
            setText(isoToDmyDate(parsed));
          } else if (value) {
            setText(isoToDmyDate(String(value)));
          }
        }}
        className="h-full min-w-[95px] flex-1 border-0 bg-transparent p-0 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            try {
              (nativeRef.current as any)?.showPicker?.();
            } catch {
              nativeRef.current?.focus();
            }
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
          title="Open date picker"
          tabIndex={-1}
        >
          <Calendar className="h-3.5 w-3.5 shrink-0" />
        </button>
        <input
          ref={nativeRef}
          type="date"
          value={String(value ?? "").slice(0, 10)}
          disabled={disabled}
          onChange={(e) => {
            const iso = e.target.value;
            setText(isoToDmyDate(iso));
            emitChange(iso);
          }}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: "1px",
            height: "1px",
            opacity: 0,
            pointerEvents: "none",
            border: 0,
            padding: 0,
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </div>
  );
});

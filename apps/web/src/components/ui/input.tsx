"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { DateTimeInputDMY, DateInputDMY } from "./datetime-dmy";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, type, ...props }, ref) {
    if (type === "datetime-local") {
      return <DateTimeInputDMY ref={ref} className={className} {...props} />;
    }
    if (type === "date") {
      return <DateInputDMY ref={ref} className={className} {...props} />;
    }
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-2xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

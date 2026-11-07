/** Validate user-supplied zones before parsing or saving any timestamps. */
export const isTimeZone = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Converts a YYYY-MM-DD (or ISO timestamp) string into DD-MM-YYYY for display.
 * Leaves non-date strings untouched.
 */
export const formatDateDMY = (value: string | null | undefined): string => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}${m[4] || ""}`;
  }
  return trimmed;
};

/** Format an instant in the journal zone using DD-MM-YYYY and 24-hour time (HH:mm:ss). */
export const formatTimestamp = (iso: string, timeZone: string): string => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("day")}-${part("month")}-${part("year")} ${part("hour")}:${part("minute")}:${part("second")}`;
};

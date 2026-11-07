export interface KillzoneClassification {
  label: string;
  shortLabel: string;
  isKillzone: boolean;
  candle7h: "18:00 Candle" | "01:00 Candle" | "08:00 Candle" | "15:00 Candle";
  dayOfWeek: string;
  dayShort: string;
  dateDMY: string;
  timeHM: string;
  nyHour: number;
  nyMinute: number;
}

const nyFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function classifyKillzoneAnd7hCandle(isoStr: string | null | undefined): KillzoneClassification {
  const d = isoStr ? new Date(isoStr) : new Date();
  if (isNaN(d.getTime())) {
    return {
      label: "Unknown Time",
      shortLabel: "—",
      isKillzone: false,
      candle7h: "08:00 Candle",
      dayOfWeek: "—",
      dayShort: "—",
      dateDMY: "—",
      timeHM: "—",
      nyHour: 0,
      nyMinute: 0,
    };
  }

  const parts = nyFormatter.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const rawHr = parseInt(map.hour || "0", 10);
  const nyHour = rawHr === 24 ? 0 : rawHr;
  const nyMinute = parseInt(map.minute || "0", 10);
  const totalMins = nyHour * 60 + nyMinute;

  const dayOfWeek = map.weekday || "—";
  const dayShort = dayOfWeek.slice(0, 3);
  const dateDMY = `${map.day || "01"}-${map.month || "01"}-${map.year || "2026"}`;
  const timeHM = `${String(nyHour).padStart(2, "0")}:${String(nyMinute).padStart(2, "0")}`;

  // Determine active 7-Hour Candle (18:00, 01:00, 08:00, 15:00 NY)
  let candle7h: KillzoneClassification["candle7h"] = "08:00 Candle";
  if (totalMins >= 18 * 60 || totalMins < 1 * 60) {
    candle7h = "18:00 Candle";
  } else if (totalMins >= 1 * 60 && totalMins < 8 * 60) {
    candle7h = "01:00 Candle";
  } else if (totalMins >= 8 * 60 && totalMins < 15 * 60) {
    candle7h = "08:00 Candle";
  } else {
    candle7h = "15:00 Candle";
  }

  // Check Killzones / Sessions:
  // 1. Asia Killzone: 20:00 - 00:00 NY
  if (totalMins >= 20 * 60 && totalMins < 24 * 60) {
    return {
      label: "Asia Killzone",
      shortLabel: "Asia KZ",
      isKillzone: true,
      candle7h,
      dayOfWeek,
      dayShort,
      dateDMY,
      timeHM,
      nyHour,
      nyMinute,
    };
  }

  // 2. London Killzone: 02:00 - 05:00 NY
  if (totalMins >= 2 * 60 && totalMins < 5 * 60) {
    return {
      label: "London Killzone",
      shortLabel: "London KZ",
      isKillzone: true,
      candle7h,
      dayOfWeek,
      dayShort,
      dateDMY,
      timeHM,
      nyHour,
      nyMinute,
    };
  }

  // 3. NY AM Session: 09:30 - 11:30 NY
  if (totalMins >= 9 * 60 + 30 && totalMins < 11 * 60 + 30) {
    return {
      label: "NY AM Session",
      shortLabel: "NY AM",
      isKillzone: true,
      candle7h,
      dayOfWeek,
      dayShort,
      dateDMY,
      timeHM,
      nyHour,
      nyMinute,
    };
  }

  // 4. NY Lunch: 11:30 - 13:30 NY
  if (totalMins >= 11 * 60 + 30 && totalMins < 13 * 60 + 30) {
    return {
      label: "NY Lunch",
      shortLabel: "NY Lunch",
      isKillzone: true,
      candle7h,
      dayOfWeek,
      dayShort,
      dateDMY,
      timeHM,
      nyHour,
      nyMinute,
    };
  }

  // 5. NY PM Session: 13:30 - 16:00 NY
  if (totalMins >= 13 * 60 + 30 && totalMins < 16 * 60) {
    return {
      label: "NY PM Session",
      shortLabel: "NY PM",
      isKillzone: true,
      candle7h,
      dayOfWeek,
      dayShort,
      dateDMY,
      timeHM,
      nyHour,
      nyMinute,
    };
  }

  // Outside Killzone -> Categorize by 7-Hour Candle with "(Outside KZ)"
  return {
    label: `${candle7h} (Outside KZ)`,
    shortLabel: `${candle7h} (Outside KZ)`,
    isKillzone: false,
    candle7h,
    dayOfWeek,
    dayShort,
    dateDMY,
    timeHM,
    nyHour,
    nyMinute,
  };
}

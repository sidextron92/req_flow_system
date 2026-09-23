/**
 * Helpers for the Bijnis trading API `stockBlockingLiveOn` field.
 * Example raw value: "24 Sep 2026, 09:00 AM"
 */

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Parse the custom `stockBlockingLiveOn` string into a native Date.
 * Returns null if the input is missing or not in the expected format.
 */
export function parseStockBlockingLiveOn(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== "string") return null;

  const match = raw.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i
  );
  if (!match) return null;

  const [, dayStr, monthStr, yearStr, hourStr, minuteStr, ampm] = match;

  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  const minute = parseInt(minuteStr, 10);
  const month = MONTH_MAP[monthStr.toLowerCase()];

  if (month === undefined || isNaN(day) || isNaN(year) || isNaN(minute)) {
    return null;
  }

  let hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return null;

  const isPm = ampm.toUpperCase() === "PM";
  const isAm = ampm.toUpperCase() === "AM";

  if (isPm && hour !== 12) hour += 12;
  if (isAm && hour === 12) hour = 0;

  const date = new Date(year, month, day, hour, minute);
  if (isNaN(date.getTime())) return null;

  return date;
}

/**
 * Format a Date as "24 Sep" or "24 Sep 2026" depending on whether the year
 * differs from the current year.
 */
function formatDate(date: Date): string {
  const now = new Date();
  const includeYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

/**
 * Return the concise, label-free trading-window text shown in the UI.
 *
 * Same day               -> "Live today"
 * Future, diff == 1 day  -> "Starts tomorrow"
 * Future, diff > 1 day   -> "Starts 24 Sep"
 * Past                   -> "Started 21 Sep"
 * Missing / invalid      -> "—"
 */
export function getTradingWindowText(
  date: Date | string | null | undefined
): string {
  if (!date) return "—";

  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / 86_400_000
  );

  if (diffDays === 0) return "Live today";
  if (diffDays === 1) return "Starts tomorrow";
  if (diffDays > 1) return `Starts ${formatDate(d)}`;
  return `Started ${formatDate(d)}`;
}

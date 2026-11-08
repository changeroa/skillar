export const KST_TIME_ZONE = "Asia/Seoul";
export const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDay(timestamp: number): number {
  return Math.floor((timestamp + KST_OFFSET_MS) / DAY_MS);
}

export function kstPeriodStart(now: number, days: number): number {
  return (kstDay(now) - days + 1) * DAY_MS - KST_OFFSET_MS;
}

export function kstWeekStart(timestamp: number): number {
  const day = kstDay(timestamp);
  const weekday = new Date(day * DAY_MS).getUTCDay();
  return (day - (weekday + 6) % 7) * DAY_MS - KST_OFFSET_MS;
}

export function kstIsoWeek(timestamp: number): string {
  const thursday = new Date(kstWeekStart(timestamp) + KST_OFFSET_MS + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const firstWeek = kstWeekStart(Date.UTC(year, 0, 4));
  const week = 1 + Math.round((kstWeekStart(timestamp) - firstWeek) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

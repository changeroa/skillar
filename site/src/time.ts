export const KST_TIME_ZONE = "Asia/Seoul";

/** Calendar date in Seoul, including the day rollover at 15:00 UTC. */
export function kstDay(milliseconds: number): string {
  return new Date(milliseconds + 9 * 3600000).toISOString().slice(0, 10);
}

export function shortKstDate(milliseconds: number): string {
  const day = kstDay(milliseconds);
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
}

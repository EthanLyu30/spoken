export function deviceTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; }
  } catch { /* use UTC when the device zone is unavailable */ }
  return "UTC";
}
export function learningDay(): string {
  const timezone = deviceTimezone();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    return `${timezone}|${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return `UTC|${new Date().toISOString().slice(0, 10)}`;
  }
}
export function statsMatchDay(stats: { timezone?: string; local_date?: string }, day: string): boolean {
  const [timezone, date] = day.split("|");
  return (!stats.timezone || stats.timezone === timezone) && (!stats.local_date || stats.local_date === date);
}

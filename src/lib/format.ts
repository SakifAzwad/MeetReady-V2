/** 30 -> "30 min", 60 -> "1 h", 90 -> "1 h 30 min", 1440 -> "1 day", 2880 -> "2 days" */
export function formatMinutes(total: number): string {
  if (total === 0) return "none";
  if (total % 1440 === 0) {
    const days = total / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** "09:00" -> "9:00 AM", "13:30" -> "1:30 PM", "24:00" -> "12:00 AM (end of day)". Same style as the booking page. */
export function formatWallTime(time: string): string {
  if (time === "24:00") return "12:00 AM (end of day)";
  const [h, m] = time.split(":").map(Number) as [number, number];
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Every 15 minutes from 00:00 to 24:00, for time pickers. */
export const QUARTER_HOURS: string[] = Array.from({ length: 97 }, (_, i) => {
  if (i === 96) return "24:00";
  return `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
});

/** Short durations for dense rows: 45 -> "45 min", 90 -> "1.5 h", 480 -> "8 h", 140 -> "2.3 h". */
export function formatHours(totalMinutes: number): string {
  const m = Math.round(totalMinutes);
  if (m < 60) return `${m} min`;
  const hours = Math.round((m / 60) * 10) / 10;
  return `${hours} h`;
}

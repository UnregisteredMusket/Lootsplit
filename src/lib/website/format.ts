/** Release dates are stored as UTC calendar days (YYYY-MM-DD). */
export function formatReleaseDate(date: string, month: "long" | "short" = "long") {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month,
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

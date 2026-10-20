/** The season leaderboard as a CSV file, for the Export button. */
import type { LeaderboardEntryDto } from "@shared/api/seasons";

/**
 * One CSV cell. Player names are typed in by players themselves, so a name a spreadsheet would run as
 * a formula (starting =, +, -, @ or a control character) is written with a leading apostrophe.
 */
function cell(value: string | number): string {
  const text = String(value);
  const inert = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(inert) ? `"${inert.replace(/"/g, '""')}"` : inert;
}

/** Lets Excel read names with macrons (Māori names) as UTF-8. */
const BYTE_ORDER_MARK = "\uFEFF";

/** Rank, player, points and tournaments, one row per player, ranked as the server ranked them. */
export function leaderboardCsv(entries: readonly LeaderboardEntryDto[]): string {
  const rows: Array<Array<string | number>> = [
    ["Rank", "Player", "Points", "Tournaments"],
    ...entries.map((entry) => [entry.rank, entry.player.name, entry.points, entry.tournaments]),
  ];
  return `${BYTE_ORDER_MARK}${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** "spring-2026-leaderboard.csv" */
export function leaderboardFileName(seasonName: string): string {
  const slug = seasonName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "season"}-leaderboard.csv`;
}

/** Hands the browser `text` as a file download named `fileName`. */
export function downloadCsv(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has started the download; revoking at once can cancel it in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

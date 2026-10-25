/**
 * What automatic seating (round 5) did with a player the desk just registered or took a payment from,
 * in the TD's words: the server seats them inside the same transaction and says where, or why not
 * (round5-contracts §3.2 rule 3, AutoSeatResultDto).
 */
import type { AutoSeatResultDto } from "@shared/api/seating";
import { seatText } from "@/features/seating/seating-text";

/**
 * "Seated at Table 2, Seat 7.", "Waiting: every table is full — open a table.", "Seated once their
 * payment is confirmed."; null when there is nothing to say (no tables yet, a seat already, or seating
 * is off: the toast's "Seat now" offer covers that).
 */
export function autoSeatText(seating: AutoSeatResultDto | null): string | null {
  if (seating === null) return null;
  if (seating.status === "seated") return `Seated at ${seatText(seating.seat)}.`;
  if (seating.reason === "tables_full") return "Waiting: every table is full — open a table.";
  if (seating.reason === "awaiting_payment") return "Seated once their payment is confirmed.";
  return null;
}

/** Whether every table was full, so the TD's next step is the Seats tab (open a table). */
export const needsTable = (seating: AutoSeatResultDto | null): boolean => seating?.status === "waiting" && seating.reason === "tables_full";

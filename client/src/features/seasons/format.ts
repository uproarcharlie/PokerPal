/** How the seasons screens write finishing positions (season dates: lib/season-dates). */
import { ordinal } from "@/lib/format";

/** "1st", or "4th–10th" for a range of finishing positions. */
export function positionRange(position: number, positionEnd: number | null | undefined): string {
  return positionEnd && positionEnd !== position ? `${ordinal(position)}–${ordinal(positionEnd)}` : ordinal(position);
}

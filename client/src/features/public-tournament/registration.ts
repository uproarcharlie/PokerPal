/**
 * The QR sign-up's rules that are not React: the new-player form's schema (POST /api/players's own,
 * with the phone number a visitor must give) and what the player owes at the desk.
 */
import { z } from "zod";
import { createPlayerSchema, normaliseName, normalisePhone, type CreatePlayerInput } from "@shared/api/players";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { amountDueCents } from "@shared/domain/prize-pool";
import { formatMoney } from "@/lib/format";
import { offersHighHand } from "@shared/domain/player-actions";

/** What the new player types (and the photo they upload); the server refuses a visitor with no phone. */
export const newPlayerSchema = createPlayerSchema.pick({ name: true, phone: true, imageUrl: true }).superRefine((value, ctx) => {
  if (!normalisePhone(value.phone)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Phone number is required" });
  }
});

export interface NewPlayerValues {
  name: string;
  phone: string;
  imageUrl: string | null;
}

export const EMPTY_NEW_PLAYER: NewPlayerValues = { name: "", phone: "", imageUrl: null };

export type PlayerDetails = Pick<CreatePlayerInput, "name" | "phone" | "imageUrl">;

/**
 * Whether two sign-ups are the same person with the same photo, as the server compares them: going
 * Back and Continue again must not sign the player up a second time (PUB-06).
 */
export function sameDetails(a: PlayerDetails, b: PlayerDetails): boolean {
  return normaliseName(a.name) === normaliseName(b.name) && normalisePhone(a.phone) === normalisePhone(b.phone) && (a.imageUrl ?? null) === (b.imageUrl ?? null);
}

type DueTournament = Pick<TournamentDetailDto, "buyInAmount" | "rebuyAmount" | "addonAmount" | "highHandAmount" | "enableHighHand">;

/** One buy-in plus the high-hands entry, to the cent, as the payment desk will ask for it (amountDueCents). */
export function amountDue(tournament: DueTournament, enteringHighHands: boolean): string {
  const entry = { buyIns: 1, rebuys: 0, addons: 0, enteringHighHands: enteringHighHands && offersHighHand(tournament) };
  return formatMoney(amountDueCents(tournament, entry), { forceCents: true });
}

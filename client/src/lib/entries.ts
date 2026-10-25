/**
 * What every screen calls an entry: a buy-in or a re-buy, each a paid way into the game. An add-on tops
 * a stack up and is counted on its own, so the TV's "Entries", the Clock tab's and a player's row in
 * the standings all count the same thing (P4REV4-R3-CQ-05).
 */
export const entriesOf = (counts: { buyIns?: number | null; rebuys?: number | null }): number => (counts.buyIns ?? 0) + (counts.rebuys ?? 0);

/**
 * A sign-up's player by name, in the same words on every staff screen when the player is missing
 * (P3REV6-CQ-04): the standings, the desks, the high-hand dialog, Correct Results and the finalize plan
 * once spelled it two ways, sometimes both on one page. The words are finalize's and the server's.
 */
export const UNKNOWN_PLAYER = "Unknown player";

export const playerName = (entry: { player?: { name: string } | null }): string => entry.player?.name || UNKNOWN_PLAYER;

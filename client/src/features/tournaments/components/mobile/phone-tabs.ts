/**
 * The TD's page on a phone has five tabs in a bottom bar (round5-contracts §8.1): Players, Seats,
 * Clock, Money and More. They live in the same `?tab=` as the wide screen's six, so a link, a reload or
 * a phone turned into a tablet opens the same things: each layout reads the other's names too
 * (desk-tabs `deskTabOf` reads these).
 */
export const PHONE_TABS = ["players", "seating", "clock", "money", "more"] as const;
export type PhoneTab = (typeof PHONE_TABS)[number];

/** Players come first on a phone: busts and late entries are the night's busiest taps. */
export const FIRST_PHONE_TAB: PhoneTab = "players";

export const isPhoneTab = (value: string | null): value is PhoneTab => (PHONE_TABS as readonly (string | null)[]).includes(value);

/** A wide screen's tab opened on a phone: the phone tab that holds it. */
const FROM_DESK: ReadonlyMap<string, PhoneTab> = new Map([
  ["standings", "players"],
  ["overview", "money"],
  ["activity", "more"],
  ["actions", "more"],
]);

/** The phone tab an address names (`?tab=`), a wide screen's tab's home, or Players for none or one the page does not have. */
export const phoneTabOf = (value: string | null): PhoneTab =>
  isPhoneTab(value) ? value : ((value === null ? undefined : FROM_DESK.get(value)) ?? FIRST_PHONE_TAB);

/**
 * Finding a player by the name they type on their phone: any part of the name, from the start of a
 * word ("ar" finds "Aroha Ngata" and "Mark Arnold"), ignoring case and accents ("Zoe" finds "Zoë").
 * One rule for every "find my name" box (the seat finder, the season standings), so a name found on
 * one is found on the other (P4REV4-CQ-07).
 */

/** A name as it is compared: no accents, lower case, single spaces. */
export function foldName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether every word typed starts one of the words of `name`. */
export function nameMatches(name: string, typed: string): boolean {
  const words = foldName(typed).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const nameWords = foldName(name).split(" ");
  return words.every((word) => nameWords.some((part) => part.startsWith(word)));
}

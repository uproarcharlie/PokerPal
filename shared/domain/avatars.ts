/**
 * The built-in player avatars (round 5, item 8): original poker-themed illustrations a player can pick
 * instead of a photo, served by the app itself as static SVGs at /avatars/<id>.svg
 * (client/public/avatars/<id>.svg: cacheable, nothing uploaded, nothing in R2). PURE: no imports.
 *
 * A player's `imageUrl` holds the avatar's path exactly as `avatarUrl` gives it; the player schemas
 * accept it beside uploaded images (shared/api/common playerImageUrlSchema), and the image components
 * draw it as a plain image (it has no size variants).
 */

export const AVATAR_IDS = [
  "spade",
  "heart",
  "diamond",
  "club",
  "shark",
  "fish",
  "ace",
  "chip-leader",
  "crown",
  "bluffer",
  "cowboy",
  "all-in",
  "dealer-button",
  "lucky-clover",
  "rocket",
  "star",
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export interface AvatarSpec {
  id: AvatarId;
  /** The picker's accessible name and caption. */
  label: string;
}

/** In the picker's order. */
export const AVATARS: readonly AvatarSpec[] = Object.freeze([
  { id: "spade", label: "Spade" },
  { id: "heart", label: "Heart" },
  { id: "diamond", label: "Diamond" },
  { id: "club", label: "Club" },
  { id: "shark", label: "Shark" },
  { id: "fish", label: "Fish" },
  { id: "ace", label: "Ace" },
  { id: "chip-leader", label: "Chip leader" },
  { id: "crown", label: "Royal crown" },
  { id: "bluffer", label: "Bluffer in sunglasses" },
  { id: "cowboy", label: "Cowboy hat" },
  { id: "all-in", label: "All in" },
  { id: "dealer-button", label: "Dealer button" },
  { id: "lucky-clover", label: "Lucky clover" },
  { id: "rocket", label: "Rocket" },
  { id: "star", label: "Star" },
] satisfies AvatarSpec[]);

/** Where the app serves the avatars (client/public/avatars). */
export const AVATAR_PATH_PREFIX = "/avatars/";

const AVATAR_URL = /^\/avatars\/([a-z-]+)\.svg$/;

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && (AVATAR_IDS as readonly string[]).includes(value);
}

/** "/avatars/shark.svg" */
export function avatarUrl(id: AvatarId): string {
  return `${AVATAR_PATH_PREFIX}${id}.svg`;
}

/** The avatar an image URL is, or null for anything else (an upload, another path, a near miss). */
export function avatarIdOf(url: string | null | undefined): AvatarId | null {
  const id = typeof url === "string" ? AVATAR_URL.exec(url)?.[1] : undefined;
  return isAvatarId(id) ? id : null;
}

export const isBuiltInAvatarUrl = (url: string | null | undefined): boolean => avatarIdOf(url) !== null;

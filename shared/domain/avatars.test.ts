import { describe, expect, it } from "vitest";
import { AVATAR_IDS, AVATAR_PATH_PREFIX, AVATARS, avatarIdOf, avatarUrl, isAvatarId, isBuiltInAvatarUrl } from "./avatars";

describe("the built-in avatars", () => {
  it("are sixteen original poker pictures, each with a label, in the picker's order", () => {
    expect(AVATARS).toHaveLength(16);
    expect(AVATARS.map((avatar) => avatar.id)).toEqual([...AVATAR_IDS]);
    expect(new Set(AVATARS.map((avatar) => avatar.label)).size).toBe(16);
    for (const avatar of AVATARS) {
      expect(avatar.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(avatar.label.trim()).not.toBe("");
    }
    expect(Object.isFrozen(AVATARS)).toBe(true);
  });

  it("are served by the app at /avatars/<id>.svg", () => {
    expect(AVATAR_PATH_PREFIX).toBe("/avatars/");
    expect(avatarUrl("shark")).toBe("/avatars/shark.svg");
    expect(avatarUrl("dealer-button")).toBe("/avatars/dealer-button.svg");
  });

  it("are recognised exactly, and nothing else is", () => {
    for (const id of AVATAR_IDS) {
      expect(avatarIdOf(avatarUrl(id))).toBe(id);
      expect(isBuiltInAvatarUrl(avatarUrl(id))).toBe(true);
      expect(isAvatarId(id)).toBe(true);
    }
    for (const url of [
      "/avatars/whale.svg",
      "/avatars/shark.png",
      "/avatars/shark.svg?x=1",
      "/avatars/../uploads/x.svg",
      "https://evil.example/avatars/shark.svg",
      "avatars/shark.svg",
      "/uploads/players/a.webp",
      "",
      null,
      undefined,
    ]) {
      expect(isBuiltInAvatarUrl(url)).toBe(false);
    }
    expect(isAvatarId("whale")).toBe(false);
    expect(isAvatarId(7)).toBe(false);
  });
});

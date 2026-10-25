/**
 * client/public is copied into every build as it is, unhashed and outside Vite's reach, so nothing
 * there may be dead weight: the old 2048 px brand images (a 780 KB logo.png nothing used and a JPEG
 * named icon.png) shipped on every deploy (P3REV-IMG-DEAD-ICONS). /assets/icon.png stays, as the
 * favicon, for pages cached from before Phase 3 that still link it. client/public/avatars holds the
 * built-in player avatars (round 5): served from our own origin, so they must hold nothing active.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_IDS, AVATARS, avatarUrl, type AvatarId } from "@shared/domain/avatars";

const PUBLIC = join(__dirname, "../../client/public");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The largest file client/public may hold: the 180 px apple-touch-icon is about 28 KB. */
const MAX_BYTES = 64 * 1024;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

describe("client/public", () => {
  it("holds only small files, each the type its name says", () => {
    const found = files(PUBLIC).map((path) => ({
      file: relative(PUBLIC, path),
      small: statSync(path).size <= MAX_BYTES,
      png: !path.endsWith(".png") || readFileSync(path).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    }));

    expect(found.filter((entry) => !entry.small || !entry.png)).toEqual([]);
  });

  it("drops the unused logo and keeps a real, small /assets/icon.png for old cached pages", () => {
    const shipped = files(PUBLIC).map((path) => relative(PUBLIC, path));

    expect(shipped).not.toContain(join("assets", "logo.png"));
    expect(shipped).toContain(join("assets", "icon.png"));
  });
});

describe("client/public/avatars (round 5)", () => {
  const AVATAR_DIR = join(PUBLIC, "avatars");
  const avatarFile = (id: AvatarId) => readFileSync(join(AVATAR_DIR, `${id}.svg`), "utf8");

  it("holds exactly one SVG per built-in avatar, at the path a player's picture names", () => {
    expect(readdirSync(AVATAR_DIR).sort()).toEqual(AVATAR_IDS.map((id) => `${id}.svg`).sort());
    for (const id of AVATAR_IDS) expect(join(PUBLIC, avatarUrl(id))).toBe(join(AVATAR_DIR, `${id}.svg`));
  });

  it("draws each one square, titled with the picker's name for it", () => {
    for (const { id, label } of AVATARS) {
      const svg = avatarFile(id);
      expect(svg, id).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
      expect(svg, id).toContain(`<title>${label}</title>`);
    }
  });

  it("holds nothing that could run or fetch: no scripts, handlers, links, embedded images or foreign objects", () => {
    for (const id of AVATAR_IDS) {
      const svg = avatarFile(id);
      expect(svg, id).not.toMatch(/<script|<foreignObject|<image|<a[\s>]|\son[a-z]+\s*=|href\s*=|url\((?!#)|@import|javascript:/i);
    }
  });
});

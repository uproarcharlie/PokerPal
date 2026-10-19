import { describe, expect, it } from "vitest";
import {
  IMAGE_KIND_NAMES,
  IMAGE_KINDS,
  imageRegion,
  imageVariantKey,
  imageVariantPlan,
  imageVariantsFromUrl,
  isImageKind,
  LEGACY_ENTITY_KINDS,
  type ImageKind,
} from "./images";

const ID = "0b9e7c2a-5d1f-4c3e-9a8b-7f6e5d4c3b2a";

describe("image kinds", () => {
  it("lists every kind, smallest variant first, and maps each legacy entity type onto one", () => {
    expect(IMAGE_KIND_NAMES).toEqual(["player_avatar", "club_logo", "club_banner", "tournament_banner"]);
    for (const kind of IMAGE_KIND_NAMES) {
      const variants = [...IMAGE_KINDS[kind].variants];
      expect(variants).toEqual([...variants].sort((a, b) => a - b));
    }
    expect(Object.values(LEGACY_ENTITY_KINDS).every(isImageKind)).toBe(true);
  });

  it("only knows its own kinds, whatever is on Object.prototype", () => {
    for (const bad of ["__proto__", "constructor", "toString", "../players", "PLAYER_AVATAR", "", null, 1]) {
      expect(isImageKind(bad)).toBe(false);
    }
  });
});

describe("imageRegion", () => {
  it("keeps the centre of the image at the kind's aspect when there is no crop", () => {
    expect(imageRegion("player_avatar", 4032, 3024)).toEqual({ left: 504, top: 0, width: 3024, height: 3024 });
    expect(imageRegion("player_avatar", 300, 400)).toEqual({ left: 0, top: 50, width: 300, height: 300 });
    expect(imageRegion("club_banner", 1200, 1200)).toEqual({ left: 0, top: 400, width: 1200, height: 400 });
    expect(imageRegion("tournament_banner", 1600, 900)).toEqual({ left: 0, top: 0, width: 1600, height: 900 });
  });

  it("never crops a logo", () => {
    expect(imageRegion("club_logo", 1000, 200)).toEqual({ left: 0, top: 0, width: 1000, height: 200 });
  });

  it("applies a crop given as fractions, then trims it to the kind's aspect around its centre", () => {
    expect(imageRegion("club_logo", 1000, 500, { x: 0.5, y: 0.2, width: 0.5, height: 0.6 })).toEqual({
      left: 500,
      top: 100,
      width: 500,
      height: 300,
    });
    expect(imageRegion("player_avatar", 1000, 500, { x: 0.5, y: 0, width: 0.5, height: 1 })).toEqual({
      left: 500,
      top: 0,
      width: 500,
      height: 500,
    });
    // 600 × 500 is too wide for a square: 50 px come off each side.
    expect(imageRegion("player_avatar", 1000, 500, { x: 0.2, y: 0, width: 0.6, height: 1 })).toEqual({
      left: 250,
      top: 0,
      width: 500,
      height: 500,
    });
  });

  it("keeps a crop inside the image and at least one pixel", () => {
    expect(imageRegion("club_logo", 100, 100, { x: 1, y: 1, width: 0.5, height: 0.5 })).toEqual({ left: 99, top: 99, width: 1, height: 1 });
    expect(imageRegion("club_logo", 100, 100, { x: 0.9, y: 0, width: 0.5, height: 1 })).toEqual({ left: 90, top: 0, width: 10, height: 100 });
    expect(imageRegion("club_logo", 100, 100, { x: 0, y: 0, width: 0.001, height: 0.001 })).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    expect(imageRegion("club_banner", 2, 1, { x: 0, y: 0, width: 0.5, height: 1 })).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });
});

describe("imageVariantPlan", () => {
  it("renders every variant a large image can fill, at the kind's exact aspect", () => {
    expect(imageVariantPlan("player_avatar", { width: 3024, height: 3024 })).toEqual([
      { variant: 48, width: 48, height: 48 },
      { variant: 96, width: 96, height: 96 },
      { variant: 256, width: 256, height: 256 },
      { variant: 512, width: 512, height: 512 },
    ]);
    expect(imageVariantPlan("club_banner", { width: 4000, height: 1333 })).toEqual([
      { variant: 640, width: 640, height: 213 },
      { variant: 1280, width: 1280, height: 427 },
      { variant: 1920, width: 1920, height: 640 },
    ]);
    expect(imageVariantPlan("tournament_banner", { width: 1600, height: 900 })).toEqual([
      { variant: 800, width: 800, height: 450 },
      { variant: 1600, width: 1600, height: 900 },
    ]);
  });

  it("fits a logo inside each variant's square, keeping its shape", () => {
    expect(imageVariantPlan("club_logo", { width: 600, height: 200 })).toEqual([
      { variant: 64, width: 64, height: 21 },
      { variant: 128, width: 128, height: 43 },
      { variant: 256, width: 256, height: 85 },
      { variant: 512, width: 512, height: 171 },
    ]);
    expect(imageVariantPlan("club_logo", { width: 30, height: 300 })[1]).toEqual({ variant: 128, width: 13, height: 128 });
  });

  it("never enlarges: only the widths the image fills, or the smallest at the image's own size", () => {
    expect(imageVariantPlan("player_avatar", { width: 300, height: 300 }).map((size) => size.variant)).toEqual([48, 96, 256]);
    expect(imageVariantPlan("player_avatar", { width: 30, height: 30 })).toEqual([{ variant: 48, width: 30, height: 30 }]);
    expect(imageVariantPlan("club_logo", { width: 20, height: 10 })).toEqual([{ variant: 64, width: 20, height: 10 }]);
  });
});

describe("stored keys and URLs", () => {
  it("files a variant under its kind and a server-made id", () => {
    expect(imageVariantKey("club_logo", ID, 256)).toBe(`club_logo/${ID}/256.webp`);
  });

  it("derives every variant from the stored (largest) URL, on R2 or local disk", () => {
    expect(imageVariantsFromUrl(`https://images.example.com/player_avatar/${ID}/256.webp`)).toEqual({
      48: `https://images.example.com/player_avatar/${ID}/48.webp`,
      96: `https://images.example.com/player_avatar/${ID}/96.webp`,
      256: `https://images.example.com/player_avatar/${ID}/256.webp`,
    });
    expect(imageVariantsFromUrl(`/uploads/tournament_banner/${ID}/800.webp`)).toEqual({
      800: `/uploads/tournament_banner/${ID}/800.webp`,
    });
  });

  it.each([
    "/uploads/players/image-1700000000000-123.webp",
    "https://pub-abc.r2.dev/players/1700000000-photo.jpg",
    `/uploads/not_a_kind/${ID}/48.webp`,
    `/uploads/player_avatar/${ID}/50.webp`,
    `/uploads/__proto__/${ID}/48.webp`,
  ])("has no variants for %s (stored before variants, or not ours)", (url) => {
    expect(imageVariantsFromUrl(url)).toBeNull();
  });

  it("round-trips every planned variant of every kind", () => {
    for (const kind of IMAGE_KIND_NAMES as ImageKind[]) {
      const widths = IMAGE_KINDS[kind].variants;
      const largest = widths[widths.length - 1];
      expect(Object.keys(imageVariantsFromUrl(`/uploads/${imageVariantKey(kind, ID, largest)}`) ?? {}).map(Number)).toEqual([...widths]);
    }
  });
});

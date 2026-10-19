import { describe, expect, it } from "vitest";
import { IMAGE_KINDS, isImageKind, LEGACY_ENTITY_KINDS } from "../domain/images";
import { imageCropFieldSchema, imageKindSchema, legacyEntityTypeSchema } from "./images";

describe("images", () => {
  it("knows the kinds, and maps the legacy entity types onto them", () => {
    expect(imageKindSchema.options).toEqual(Object.keys(IMAGE_KINDS));
    expect(isImageKind("club_logo")).toBe(true);
    for (const bad of ["__proto__", "constructor", "../x", 7]) expect(isImageKind(bad)).toBe(false);
    for (const kind of Object.values(LEGACY_ENTITY_KINDS)) expect(isImageKind(kind)).toBe(true);
    expect(legacyEntityTypeSchema.safeParse("../escaped").success).toBe(false);
  });

  it("only a player photo may be uploaded without signing in", () => {
    const publicKinds = Object.entries(IMAGE_KINDS).filter(([, spec]) => spec.publicUpload).map(([kind]) => kind);

    expect(publicKinds).toEqual(["player_avatar"]);
  });

  it("reads the crop field as JSON fractions that stay inside the image", () => {
    expect(imageCropFieldSchema.parse(undefined)).toBeUndefined();
    expect(imageCropFieldSchema.parse('{"x":0.1,"y":0,"width":0.8,"height":1}')).toEqual({ x: 0.1, y: 0, width: 0.8, height: 1 });
    for (const bad of ["{", '{"x":0.5,"y":0,"width":0.6,"height":1}', '{"x":0,"y":0,"width":0,"height":1}']) {
      expect(imageCropFieldSchema.safeParse(bad).success).toBe(false);
    }
  });
});

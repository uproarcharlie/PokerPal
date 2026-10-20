/**
 * A card's title is a CardTitle (a heading with the one card-title style, P3REV3-CQ-10), never a heading
 * typed out by hand inside a CardHeader with a copy of its classes, which drifts and which a club theme
 * (Phase 5) would have to restyle one by one. A page's own h1 may sit in a card (the sign-in pages).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../client/src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "ui" ? [] : sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe("card titles", () => {
  it("are CardTitles, not hand-made h2 to h6 headings in a CardHeader", () => {
    const handMade = sources(ROOT).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return Array.from(text.matchAll(/<CardHeader[^>]*>((?:(?!<\/CardHeader>)[\s\S])*?)<h[2-6][\s>]/g), () => relative(ROOT, file));
    });

    expect(handMade).toEqual([]);
  });
});

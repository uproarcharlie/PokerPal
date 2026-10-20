/**
 * Tailwind's preflight takes the markers off every ul and ol, and Safari then exposes such a list as a
 * plain group: VoiceOver says no "list, N items" and cannot move from item to item (P3REV-MA-VO-LISTS).
 * Every list in the client says role="list" (the lint rule in eslint.config.js says the same).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../client/src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe("lists", () => {
  it('say role="list", so Safari still announces them once their markers are gone', () => {
    const unnamed = sources(ROOT).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return Array.from(text.matchAll(/<(ul|ol)(?=[\s>])([^>]*)>/g))
        .filter((match) => !/\brole="list"/.test(match[2]))
        .map((match) => `${relative(ROOT, file)}: <${match[1]}${match[2]}>`);
    });

    expect(unnamed).toEqual([]);
  });
});

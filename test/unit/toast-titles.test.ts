/**
 * A toast's title says what happened ("Player restored", "Could not save the club"), as phase3-
 * conventions §3.4 asks, in every feature: a bold "Success" or "Error" above the real sentence told a
 * TD glancing at a phone nothing (P3REV5-CQ-12).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT = join(__dirname, "../../client/src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("toast titles", () => {
  it("are never a bare Success or Error", () => {
    const generic = sourceFiles(CLIENT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (/title:\s*"(Success|Error)"/.test(line) ? [`${relative(CLIENT, file)}:${index + 1}`] : [])),
    );
    expect(generic).toEqual([]);
  });
});

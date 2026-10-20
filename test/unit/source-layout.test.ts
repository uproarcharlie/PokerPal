/**
 * The repo has no formatter yet (adding Prettier is a request to the lead), so two hand-formatting
 * slips that lint does not catch are checked here (P3REV3-CQ-15): an object closed on the same line as
 * the call inside it (`}),};`), and a JSX element opened at the same indent as the element it is inside.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "ui" ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = ["client/src", "shared", "server"].flatMap(sources);
const indent = (line: string) => line.length - line.trimStart().length;

describe("source layout", () => {
  it("closes an object on its own line, not on the line that closes the call inside it", () => {
    const slips = files.flatMap((file) =>
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .flatMap((line, index) => (/\)\s*,\s*\};\s*$/.test(line) ? [`${relative(ROOT, join(ROOT, file))}:${index + 1}`] : [])),
    );

    expect(slips).toEqual([]);
  });

  it("indents a JSX element inside the one opened on the line before it", () => {
    const slips = files
      .filter((file) => file.endsWith(".tsx"))
      .flatMap((file) => {
        const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
        return lines.flatMap((line, index) => {
          const next = lines[index + 1] ?? "";
          // An opening tag that ends its line (`<Suspense fallback={…}>`), then another opening tag at its indent.
          const opens = /^\s*<[A-Z][\w.]*(\s.*)?>\s*$/.test(line) && !/\/>\s*$/.test(line) && !line.includes("</");
          const nextOpens = /^\s*<[A-Za-z]/.test(next) && !/^\s*<\//.test(next);
          return opens && nextOpens && indent(next) <= indent(line) ? [`${file}:${index + 2}`] : [];
        });
      });

    expect(slips).toEqual([]);
  });
});

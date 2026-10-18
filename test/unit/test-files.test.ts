import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

/**
 * Vitest silently ignores a test file that matches no project's `include`, so
 * a misnamed test (e.g. `server/services/x.test.ts`, which is neither `.unit`
 * nor `.api`) would look written but never run. Every test file must match
 * exactly one project, apart from the Playwright specs in test/e2e.
 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SEARCHED = ["client", "server", "shared", "test", "scripts"];
const PLAYWRIGHT_DIR = "test/e2e/";
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function testFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testFiles(relative);
    return TEST_FILE.test(entry.name) ? [relative] : [];
  });
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `**` directories, `*` and `{a,b}`: the only glob syntax the includes use (asserted below). */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 2;
    } else if (glob[i] === "*") {
      source += "[^/]*";
    } else if (glob[i] === "{") {
      const end = glob.indexOf("}", i);
      source += `(?:${glob.slice(i + 1, end).split(",").map(escapeRegExp).join("|")})`;
      i = end;
    } else {
      source += escapeRegExp(glob[i]);
    }
  }
  return new RegExp(`^${source}$`);
}

const projects = (config.test?.projects ?? []).flatMap((project) => {
  if (typeof project !== "object" || project instanceof Promise) return [];
  const { name, include = [] } = project.test ?? {};
  return [{ name: typeof name === "object" ? name.label : name, include, patterns: include.map(globToRegExp) }];
});
const projectsFor = (file: string) => projects.filter((project) => project.patterns.some((pattern) => pattern.test(file)));

describe("test file naming", () => {
  it("reads the unit, api and web projects from vitest.config.ts, whose globs this check understands", () => {
    expect(projects.map((project) => project.name)).toEqual(["unit", "api", "web"]);
    for (const glob of projects.flatMap((project) => project.include)) {
      expect(glob.replace(/\*\*\/|\*|\{[\w.,-]+\}/g, "")).toMatch(/^[\w./-]+$/);
    }
  });

  it("puts every test file in exactly one Vitest project (or in test/e2e for Playwright)", () => {
    const files = SEARCHED.flatMap(testFiles).filter((file) => !file.startsWith(PLAYWRIGHT_DIR));
    const misplaced = files
      .map((file) => ({ file, projects: projectsFor(file).map((project) => project.name) }))
      .filter((entry) => entry.projects.length !== 1);

    expect(files).toContain("server/db/migrate.unit.test.ts");
    expect(misplaced).toEqual([]);
  });

  it("tells misnamed tests from well-named ones", () => {
    expect(["server/services/payouts.test.ts", "test/api/clubs.test.ts", "test/helpers/auth.test.ts"].map(projectsFor)).toEqual([[], [], []]);
    expect(projectsFor("client/src/lib/format.test.ts").map((project) => project.name)).toEqual(["web"]);
    expect(projectsFor("shared/domain/clock.test.ts").map((project) => project.name)).toEqual(["unit"]);
  });
});

/**
 * Every client component and page is used somewhere. A component nothing renders still gets edited
 * when the API changes, and goes stale against it: the old Create Player modal posted to /api/players
 * without a club, so a player it made would have had no home club (P2REV4-CQ2-11).
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

/** The names a module exports: `export function X`, `export const X`, `export default function X`. */
function exportedNames(text: string): string[] {
  return Array.from(text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g), (match) => match[1]);
}

const IMPORT_STATEMENT = /import\s[\s\S]*?from\s+["'][^"']+["'];?/g;

describe("client components", () => {
  it("are each imported and used (not merely imported) by some other client module, the shadcn ui kit aside", () => {
    const files = sourceFiles(CLIENT);
    const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
    const components = files.filter((file) => {
      const path = relative(CLIENT, file);
      return /^(components|pages|app|features)\//.test(path) && !path.startsWith("components/ui/") && path.endsWith(".tsx");
    });

    const unused = components
      .filter((file) => {
        const module = relative(CLIENT, file).replace(/\.tsx$/, "");
        const base = module.split("/").pop() as string;
        // A static import, or the router's lazy `import("...")` of a page.
        const imports = new RegExp(`(?:from |import\\()["'](?:@/${module}|\\.{1,2}/(?:[^"']*/)?${base})["']`);
        const names = exportedNames(sources.get(file) ?? "");
        return !Array.from(sources).some(([other, text]) => {
          if (other === file || !imports.test(text)) return false;
          const body = text.replace(IMPORT_STATEMENT, "");
          // A default export may be imported under any name: being imported is enough for it.
          return names.length === 0 || /export\s+default\s/.test(sources.get(file) ?? "") || names.some((name) => new RegExp(`\\b${name}\\b`).test(body));
        });
      })
      .map((file) => relative(CLIENT, file))
      .sort();

    expect(unused).toEqual([]);
  });
});

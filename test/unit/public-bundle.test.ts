/**
 * Public pages never download staff code. Players open the tournament, sign-up and club pages on their
 * phones from a QR code, so the router loads every page, and the staff layout, on demand. This walks
 * the static imports (what the bundler puts in the scripts a page loads; `import type` disappears and
 * `import()` is a script of its own) from the app's entry and from every page the router shows in the
 * public, sign-in or TV display layout.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const CLIENT = join(ROOT, "client/src");
const ALIASES: Array<[string, string]> = [
  ["@/", `${CLIENT}/`],
  ["@shared/", `${ROOT}/shared/`],
];

/** `import … from "x"`, `import "x"` and `export … from "x"`, minus the type-only forms. */
const STATIC_IMPORT = /^\s*(import|export)\s+(?!type\s)([^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

/** Only `type` names between the braces (`import { type A, type B } from "x"`): elided like `import type`. */
const onlyTypes = (clause: string) => {
  const names = /\{([^}]*)\}/.exec(clause)?.[1].split(",").map((name) => name.trim()).filter(Boolean);
  return /^\s*\{[^}]*\}\s*from\s*$/.test(clause) && names !== undefined && names.length > 0 && names.every((name) => name.startsWith("type "));
};

function resolveImport(from: string, specifier: string): string | null {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  let base: string;
  if (alias) base = alias[1] + specifier.slice(alias[0].length);
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  // A package: "zod", "@tiptap/react", "@googlemaps/js-api-loader".
  else return `package:${specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]}`;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null; // CSS, images and fonts.
}

/** Everything `file` loads with it, each mapped to the module that first imports it. */
function staticClosure(file: string): Map<string, string> {
  const importedBy = new Map<string, string>([[file, ""]]);
  const queue = [file];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    if (current.startsWith("package:")) continue;
    for (const [, , clause = "", specifier] of Array.from(readFileSync(current, "utf8").matchAll(STATIC_IMPORT))) {
      if (onlyTypes(clause)) continue;
      const target = resolveImport(current, specifier);
      if (target === null || importedBy.has(target)) continue;
      importedBy.set(target, current);
      queue.push(target);
    }
  }
  return importedBy;
}

const name = (module: string) => (module.startsWith("package:") ? module.slice("package:".length) : relative(ROOT, module));

/** How `module` got into `closure`, from the page down. */
function chain(closure: Map<string, string>, module: string): string {
  const links: string[] = [];
  for (let at: string | undefined = module; at; at = closure.get(at)) links.unshift(name(at));
  return links.join(" -> ");
}

/** The staff screens' code: their layout, pages and features, the staff-only halves of shared features, the editor and maps. */
const STAFF_ONLY = [
  /^client\/src\/app\/layouts\/admin-layout\.tsx$/,
  /^client\/src\/components\/layout\//,
  /^client\/src\/components\/auth\/protected-route\.tsx$/,
  /^client\/src\/features\/(dashboard|players|users)\//,
  /^client\/src\/features\/[^/]+\/staff-(api|hooks)\.ts$/,
  /^client\/src\/features\/tournaments\/(?!api\.ts$|hooks\.ts$|components\/activity-feed\.tsx$)/,
  /^client\/src\/features\/seasons\/(?!api\.ts$|hooks\.ts$|components\/(season-leaderboard-card|season-leaderboard-table|rank-badge|active-season-badge)\.tsx$)/,
  /^client\/src\/features\/clubs\/components\/(rich-text-editor|address-autocomplete)\.tsx$/,
  // Phase 4: the TD's seating, clock and AP panels; the TV, the seat finder and the season page load only these.
  /^client\/src\/features\/(seating|clock|prize-pool|public-season)\/(?!api\.ts$|hooks\.ts$|server-time\.ts$|pages\/|components\/public\/)/,
  /^(@tiptap\/|@googlemaps\/)/,
];

/** The public pages with a form to check before sending; every other public page only shows things. */
const PAGES_WITH_FORMS = new Set(["Login", "Register", "PublicRegister", "PlayerActions"]);

function publicPages(): Array<{ page: string; file: string }> {
  const router = readFileSync(join(CLIENT, "app/router.tsx"), "utf8");
  const lazyPages = new Map(Array.from(router.matchAll(/const (\w+) = lazy(?:Page)?\(\(\) => import\("([^"]+)"\)\)/g), ([, page, path]) => [page, path]));
  const shown = Array.from(router.matchAll(/<(?:PublicLayout|AuthLayout|DisplayLayout)>\s*<(\w+) \/>/g), ([, page]) => page);
  return shown
    .filter((page) => lazyPages.has(page))
    .map((page) => ({ page, file: resolveImport(join(CLIENT, "app/router.tsx"), lazyPages.get(page) as string) as string }));
}

describe("the scripts a public page loads", () => {
  const entry = staticClosure(join(CLIENT, "main.tsx"));
  const pages = publicPages();

  it("cover every page in the public, sign-in and TV display layouts", () => {
    expect(pages.map(({ page }) => page)).toEqual(
      expect.arrayContaining(["Landing", "PublicTournament", "PublicRegister", "Login", "StaffInvite", "PublicSeats", "PublicSeason", "ClockDisplay"]),
    );
    for (const { file } of pages) expect(existsSync(file)).toBe(true);
  });

  it("start from an entry that holds no page and no staff code (both load on demand)", () => {
    const found = Array.from(entry.keys()).filter((module) => /\/pages\//.test(module) || STAFF_ONLY.some((rule) => rule.test(name(module))));
    expect(found.map((module) => chain(entry, module))).toEqual([]);
  });

  it("never include staff code", () => {
    const found = pages.flatMap(({ file }) => {
      const closure = staticClosure(file);
      return Array.from(closure.keys())
        .filter((module) => module !== file && (/\/pages\//.test(module) || STAFF_ONLY.some((rule) => rule.test(name(module)))))
        .map((module) => chain(closure, module));
    });
    expect(found).toEqual([]);
  });

  it("leave out zod, and the request schemas built with it, on pages that only show things", () => {
    const found = [...pages.filter(({ page }) => !PAGES_WITH_FORMS.has(page)).map(({ file }) => file), join(CLIENT, "main.tsx")].flatMap((file) => {
      const closure = staticClosure(file);
      return closure.has("package:zod") ? [chain(closure, "package:zod")] : [];
    });
    expect(found).toEqual([]);
  });
});

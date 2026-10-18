import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { derivedName, isWorkerDatabaseOf, reservedSegmentOf } from "../setup/database-names";
import { assertSafeTestDbUrl, resolveTestDbUrl } from "../setup/db-guard";

const DEV_URL = "postgres://localhost:5432/pokerpal";

/** Whether `name` can be a run's base name: the guard accepts it as TEST_DB_NAME. */
function isBaseName(name: string): boolean {
  try {
    assertSafeTestDbUrl(resolveTestDbUrl({ DATABASE_URL: DEV_URL, TEST_DB_NAME: name }), { NODE_ENV: "test" });
    return true;
  } catch {
    return false;
  }
}

/** Every database a run with base `base` creates, plus the base itself (which seed scripts fill). */
function databasesOf(base: string): string[] {
  const workers = ["1", "2", "12"].map((poolId) => derivedName.worker(base, poolId));
  const scratch = workers.flatMap((worker) => ["migrate", "w1", "template", "e2e"].map((suffix) => derivedName.scratch(worker, suffix)));
  return [base, derivedName.template(base), derivedName.e2e(base), ...workers, ...scratch];
}

/** Whether a run with base `base` drops `name`: its api run's worker clones and template, and its e2e database. */
function isDroppedBy(base: string, name: string): boolean {
  return isWorkerDatabaseOf(base, name) || name === derivedName.template(base) || name === derivedName.e2e(base);
}

// Segments chosen so generated names often share prefixes with, or look like, another run's derived names.
const segment = fc.constantFrom("pokerpal", "test", "w", "w1", "w2", "w12", "web", "wave2", "template", "e2e", "b", "mine", "1", "x2");
const baseName = fc
  .tuple(fc.array(segment, { maxLength: 2 }), fc.array(segment, { maxLength: 3 }))
  .map(([before, after]) => ["pokerpal", ...before, "test", ...after].join("_"))
  .filter(isBaseName);

describe("the databases each test run names after its TEST_DB_NAME", () => {
  it("never include a database another run would drop", () => {
    fc.assert(
      fc.property(baseName, baseName, (a, b) => {
        fc.pre(a !== b);
        expect(databasesOf(b).filter((name) => isDroppedBy(a, name))).toEqual([]);
      }),
      { numRuns: 2_000 },
    );
  });

  it("are all dropped by the run itself, apart from its base", () => {
    const [, ...derived] = databasesOf("pokerpal_test_mine");

    expect(derived.filter((name) => !isDroppedBy("pokerpal_test_mine", name))).toEqual([]);
  });

  it("cannot be the base of another run (the guard refuses each one as TEST_DB_NAME)", () => {
    expect(databasesOf("pokerpal_test").slice(1).filter(isBaseName)).toEqual([]);
  });
});

describe("isWorkerDatabaseOf", () => {
  it.each([
    ["pokerpal_test_w1", true],
    ["pokerpal_test_w12", true],
    ["pokerpal_test_w2_migrate", true],
    ["pokerpal_test_web", false],
    ["pokerpal_test_wave2", false],
    ["pokerpal_test_w", false],
    ["pokerpal_test_w2a", false],
    ["pokerpal_test_template", false],
  ])("for the default run, %s: %s", (name, expected) => {
    expect(isWorkerDatabaseOf("pokerpal_test", name)).toBe(expected);
  });
});

describe("reservedSegmentOf", () => {
  it.each([
    ["pokerpal_test_w2", "w2"],
    ["pokerpal_test_w2_mine", "w2"],
    ["pokerpal_test_template", "template"],
    ["pokerpal_test_e2e", "e2e"],
    ["a_test_w1_test", "w1"],
    ["pokerpal_test_web", undefined],
    ["pokerpal_test_wave2", undefined],
    ["pokerpal_test_e2e2", undefined],
    ["pokerpal_test", undefined],
  ])("%s → %s", (name, expected) => {
    expect(reservedSegmentOf(name)).toBe(expected);
  });
});

/**
 * How a run names its databases from its base name (TEST_DB_NAME, default
 * `pokerpal_test`). A run drops and recreates every name it derives, so two
 * runs with different base names must never derive the same name, nor each
 * other's base. Each derived name adds an underscore-separated segment
 * (`w<digits>`, `template` or `e2e`), so a base name may not contain one
 * (db-guard.ts refuses it): then no name a run derives can belong to another.
 * test/unit/database-names.test.ts checks this over generated pairs of names.
 */
export const derivedName = {
  /** Built once per api run by the real migrations; every worker clones it. */
  template: (base: string) => `${base}_template`,
  /** One api worker's clone of the template, by its VITEST_POOL_ID. */
  worker: (base: string, poolId: string | number) => `${base}_w${poolId}`,
  /** An empty database a test file makes beside its worker's clone (test/helpers/scratch-db.ts). */
  scratch: (worker: string, suffix: string) => `${worker}_${suffix}`,
  /** The database the e2e server boots on. */
  e2e: (base: string) => `${base}_e2e`,
};

/**
 * Whether `name` is one of `base`'s worker clones, or a scratch database beside
 * one: what an api run drops when it starts (left by an interrupted run) and ends.
 */
export function isWorkerDatabaseOf(base: string, name: string): boolean {
  const prefix = derivedName.worker(base, "");
  return name.startsWith(prefix) && /^\d+(?:_[a-z0-9_]+)?$/.test(name.slice(prefix.length));
}

const RESERVED_SEGMENT = /(?:^|_)(w\d+|template|e2e)(?=_|$)/;

/** The segment of `base` that only derived names may have, if any (e.g. "w2" in `pokerpal_test_w2`). */
export function reservedSegmentOf(base: string): string | undefined {
  return RESERVED_SEGMENT.exec(base)?.[1];
}

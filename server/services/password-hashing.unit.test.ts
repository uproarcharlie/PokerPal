import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it } from "vitest";
import { createPasswordHasher, type PasswordHasher } from "./password-hashing";

const hashers: PasswordHasher[] = [];
const hasher = (options?: Parameters<typeof createPasswordHasher>[0]) => {
  const created = createPasswordHasher(options);
  hashers.push(created);
  return created;
};

afterEach(async () => {
  await Promise.all(hashers.splice(0).map((created) => created.close()));
});

describe("createPasswordHasher (SEC-P2REV-01)", () => {
  it("hashes and checks passwords exactly as bcryptjs does, both ways", async () => {
    const pool = hasher();
    const hashed = await pool.hash("Sturdy-Pass2", 4);

    expect(hashed).toMatch(/^\$2b\$04\$/);
    expect(bcrypt.compareSync("Sturdy-Pass2", hashed)).toBe(true);
    expect(await pool.compare("Sturdy-Pass2", bcrypt.hashSync("Sturdy-Pass2", 4))).toBe(true);
    expect(await pool.compare("Wrong-Pass1", hashed)).toBe(false);
  });

  it("does the work off the main thread, so other requests keep being answered meanwhile", async () => {
    const pool = hasher({ workers: 2 });
    const costTwelve = bcrypt.hashSync("Anything-1", 12);
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 5);
    const started = Date.now();
    try {
      await Promise.all([pool.compare("Wrong-Pass1", costTwelve), pool.compare("Wrong-Pass2", costTwelve)]);
    } finally {
      clearInterval(ticker);
    }
    const elapsed = Date.now() - started;

    // On the main thread bcryptjs blocks in 100 ms slices, so a 5 ms timer would fire about once per
    // slice (elapsed / 100). Off it, the timer keeps firing, give or take a busy machine.
    expect(ticks).toBeGreaterThan(elapsed / 25);
  });

  it("refuses work with 503 once the queue in front of the workers is full, rather than queueing without end", async () => {
    const pool = hasher({ workers: 1, maxQueued: 1 });
    const costTen = bcrypt.hashSync("Anything-1", 10);

    const running = pool.compare("Anything-1", costTen);
    const queued = pool.compare("Anything-1", costTen);
    const refused = pool.compare("Anything-1", costTen);

    await expect(refused).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(await running).toBe(true);
    expect(await queued).toBe(true);
    // Once the queue drains, work is taken again.
    expect(await pool.compare("Wrong-Pass1", costTen)).toBe(false);
  });

  it("starts fresh workers after being closed, failing only the work that was in progress", async () => {
    const pool = hasher({ workers: 1 });
    const inProgress = expect(pool.compare("Anything-1", bcrypt.hashSync("Anything-1", 12))).rejects.toThrow(/closed/);
    await pool.close();

    await inProgress;
    expect(await pool.compare("Anything-1", bcrypt.hashSync("Anything-1", 4))).toBe(true);
  });
});

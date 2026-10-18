/**
 * The app pool keeps pg's own defaults apart from `max`, as it did before the
 * env refactor: when every connection is busy, or the database is slow to
 * answer, a request's query waits for a connection instead of failing with a
 * connect timeout (which the routes would turn into a 500).
 */
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv, setEnv } from "./config/env";
import { closePool, getPool } from "./db";

const sockets = new Set<net.Socket>();
let silent: net.Server | undefined;

afterEach(async () => {
  vi.useRealTimers();
  // Dropping the half-open connections fails the queued queries, so the pool can close.
  silent?.close();
  sockets.forEach((socket) => socket.destroy());
  await closePool();
  silent = undefined;
});

describe("getPool", () => {
  it("queues queries while its only connection is still being made, however long that takes", async () => {
    // Accepts connections and never answers, like a database that is up but stalled.
    silent = net.createServer((socket) => {
      sockets.add(socket);
    });
    await new Promise<void>((resolve) => silent?.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as net.AddressInfo;
    setEnv(loadEnv({ DATABASE_URL: `postgres://nobody@127.0.0.1:${port}/stalled_test`, DB_POOL_MAX: "1" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const pool = getPool();
    const settled: string[] = [];
    for (const label of ["first", "second"]) {
      pool.query("SELECT 1").then(
        () => settled.push(`${label}: answered`),
        (error: Error) => settled.push(`${label}: ${error.message}`),
      );
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(settled).toEqual([]);
    expect(pool.waitingCount).toBe(1);
  });
});

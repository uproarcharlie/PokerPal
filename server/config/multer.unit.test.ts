import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../http/errors";
import { createUploadIntake, type UploadIntakeLimits } from "./multer";

const BOUNDARY = "----pokerpal-test";
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The start of a multipart body with one PNG in `image`, without its closing boundary. */
function multipartStart(caller: string): Buffer {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="image"; filename="${caller}.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  return Buffer.concat([head, PNG_HEADER]);
}

interface Upload {
  /** Resolves with the status, or "closed" when the server dropped the connection without one. */
  answer: Promise<number | "closed">;
  /** The response body's `error`, once answered. */
  error: Promise<string | undefined>;
  finish(): void;
}

interface Caller {
  /** The caller's address (default: one of its own). */
  address?: string;
  /** Their account, when signed in. */
  account?: string;
}

let callers = 0;

/** Starts an upload and leaves its body unfinished until `finish()` (a slow phone, or a stalled attacker). */
function startUpload(port: number, { address = `address-${++callers}`, account }: Caller = {}): Upload {
  const req = http.request({
    port,
    method: "POST",
    path: "/upload",
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "x-address": address,
      ...(account ? { "x-account": account } : {}),
    },
  });
  let body = "";
  let resolveError: (error: string | undefined) => void = () => {};
  const error = new Promise<string | undefined>((resolve) => (resolveError = resolve));
  const answer = new Promise<number | "closed">((resolve) => {
    req.on("response", (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        try {
          resolveError((JSON.parse(body) as { error?: string }).error);
        } catch {
          resolveError(undefined);
        }
      });
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => {
      resolveError(undefined);
      resolve("closed");
    });
  });
  req.write(multipartStart(address));
  return {
    answer,
    error,
    finish: () => {
      req.end(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
    },
  };
}

let server: http.Server | undefined;

/** Requests a stand-in for the rate limiters mounted between admission and the body, counted. */
let limiterCounted = 0;
let admittedWaiters: Array<{ count: number; resolve: () => void }> = [];

/**
 * Resolves once `count` uploads have been admitted: the stand-in limiter runs right after admission
 * took the slot, so this is the server's own signal, never a guess at how long the network takes
 * (P2REV4-CQ2-15).
 */
function admitted(count: number): Promise<void> {
  if (limiterCounted >= count) return Promise.resolve();
  return new Promise((resolve) => admittedWaiters.push({ count, resolve }));
}

/** Limits that stay out of the way unless a test is about them. */
const roomy: UploadIntakeLimits = {
  maxInFlight: 10,
  maxPerAccount: 5,
  maxPerAddress: 5,
  bodyTimeoutMs: 10_000,
  minBytesPerSecond: 0,
  slowGraceMs: 10_000,
};

async function listen(overrides: Partial<UploadIntakeLimits>): Promise<number> {
  const app: Express = express();
  const intake = createUploadIntake({ ...roomy, ...overrides }, (req) => ({
    address: req.get("x-address") ?? "unknown",
    account: req.get("x-account"),
  }));
  const limiter: express.RequestHandler = (_req, _res, next) => {
    limiterCounted++;
    admittedWaiters = admittedWaiters.filter((waiter) => (limiterCounted >= waiter.count ? (waiter.resolve(), false) : true));
    next();
  };
  app.post("/upload", intake.admit, limiter, intake.receive, (req, res) => {
    res.status(201).json({ bytes: req.file?.size ?? 0 });
  });
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  return (server.address() as AddressInfo).port;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  limiterCounted = 0;
  admittedWaiters = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Uploads a test left unfinished on purpose would otherwise keep the server open.
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe("createUploadIntake: bodies still arriving are bounded, not only renders (P2REV0-04)", () => {
  it("refuses an upload past the bodies being read at once (503), and frees the slot once a body is in", async () => {
    const port = await listen({ maxInFlight: 2 });
    const slow = [startUpload(port), startUpload(port)];
    await admitted(2);

    const third = startUpload(port);
    expect(await third.answer).toBe(503);

    slow[0].finish();
    expect(await slow[0].answer).toBe(201);
    const fourth = startUpload(port);
    fourth.finish();
    expect(await fourth.answer).toBe(201);
    slow[1].finish();
    expect(await slow[1].answer).toBe(201);
  });

  it("holds one caller to their own few bodies at once (429), leaving room for everyone else", async () => {
    const port = await listen({ maxPerAccount: 1, maxPerAddress: 1 });
    const first = startUpload(port, { address: "flood" });
    await admitted(1);

    const second = startUpload(port, { address: "flood" });
    const someoneElse = startUpload(port, { address: "phone" });
    someoneElse.finish();

    expect(await second.answer).toBe(429);
    expect(await someoneElse.answer).toBe(201);
    first.finish();
    expect(await first.answer).toBe(201);
  });

  it("refuses a body that does not arrive in time (408) and drops the connection, freeing its slot", async () => {
    const port = await listen({ maxInFlight: 1, bodyTimeoutMs: 100 });
    const stalled = startUpload(port);

    expect(await stalled.answer).toBe(408);
    const next = startUpload(port);
    next.finish();
    expect(await next.answer).toBe(201);
  });

  it("refuses a body trickling in slower than the minimum rate once the grace period is up, long before the timeout (SEC-P2REV-02)", async () => {
    const port = await listen({ maxInFlight: 1, bodyTimeoutMs: 60_000, minBytesPerSecond: 1_000_000, slowGraceMs: 50 });
    const started = Date.now();
    const trickle = startUpload(port);

    expect(await trickle.answer).toBe(408);
    expect(await trickle.error).toBe("The picture took too long to arrive. Please try again on a better connection.");
    expect(Date.now() - started).toBeLessThan(5_000);
    // A body that arrives at once is never held to it, and the slot is free again.
    const quick = startUpload(port);
    quick.finish();
    expect(await quick.answer).toBe(201);
  });
});

describe("createUploadIntake: a venue's phones share one address (TN-REV2-01)", () => {
  it("lets several signed-out phones on one address upload at once, and says the network is busy, not the player", async () => {
    const port = await listen({ maxInFlight: 8, maxPerAccount: 1, maxPerAddress: 3 });
    const phones = [startUpload(port, { address: "venue" }), startUpload(port, { address: "venue" }), startUpload(port, { address: "venue" })];
    await admitted(3);

    const fourth = startUpload(port, { address: "venue" });

    expect(await fourth.answer).toBe(429);
    expect(await fourth.error).toBe("Several pictures are uploading from this network right now. Please try again in a moment.");
    for (const phone of phones) phone.finish();
    for (const phone of phones) expect(await phone.answer).toBe(201);
  });

  it("holds a signed-in account to its own share, with a message about their own upload", async () => {
    const port = await listen({ maxInFlight: 8, maxPerAccount: 1, maxPerAddress: 3 });
    const first = startUpload(port, { account: "td" });
    await admitted(1);

    const second = startUpload(port, { account: "td" });

    expect(await second.answer).toBe(429);
    expect(await second.error).toBe("Another picture from you is still uploading. Please wait for it to finish.");
    first.finish();
    expect(await first.answer).toBe(201);
  });

  it("counts signed-in uploads against their address as well, so accounts opened on one address never fill the intake (SEC-P2REV-02)", async () => {
    const port = await listen({ maxInFlight: 8, maxPerAccount: 2, maxPerAddress: 3 });
    const held = [
      startUpload(port, { address: "attacker", account: "one" }),
      startUpload(port, { address: "attacker", account: "one" }),
      startUpload(port, { address: "attacker", account: "two" }),
    ];
    await admitted(3);

    const fourth = startUpload(port, { address: "attacker", account: "three" });
    expect(await fourth.answer).toBe(429);
    expect(await fourth.error).toBe("Several pictures are uploading from this network right now. Please try again in a moment.");

    // Everyone else still uploads, signed in or not.
    const td = startUpload(port, { address: "club", account: "td" });
    const phone = startUpload(port, { address: "venue" });
    td.finish();
    phone.finish();
    expect([await td.answer, await phone.answer]).toEqual([201, 201]);
    for (const upload of held) upload.finish();
    for (const upload of held) expect(await upload.answer).toBe(201);
  });

  it("refuses a busy upload before the rate limiters count it, so a retry never uses up the venue's budget", async () => {
    const port = await listen({ maxInFlight: 1 });
    const slow = startUpload(port);
    await admitted(1);
    expect(limiterCounted).toBe(1);

    for (let retry = 0; retry < 3; retry++) {
      const refused = startUpload(port);
      expect(await refused.answer).toBe(503);
    }

    expect(limiterCounted).toBe(1);
    slow.finish();
    expect(await slow.answer).toBe(201);
    const next = startUpload(port);
    next.finish();
    expect(await next.answer).toBe(201);
    expect(limiterCounted).toBe(2);
  });
});

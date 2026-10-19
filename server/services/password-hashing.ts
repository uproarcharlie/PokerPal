/**
 * bcrypt off the request thread (SEC-P2REV-01). bcryptjs is pure JavaScript: a cost-12 hash or compare
 * is about a quarter of a second of CPU, and on the main thread it holds up every other request (live
 * polling, QR sign-ups) in 100 ms slices. Here a small pool of worker threads does that work, so a flood
 * of sign-ins or password changes can slow those down but never the rest of the site. The queue in
 * front of the pool is bounded: past it a request is refused at once with 503 rather than left waiting.
 * The rate limiters (rate-limits.ts: passwordVisitor, signInAccount, passwordChange) bound how much
 * hashing any one visitor or account can ask for in the first place.
 */
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { HttpError } from "../http/errors";

export interface PasswordHasherOptions {
  /** Worker threads (default: one per spare CPU, between 1 and 2). */
  workers?: number;
  /** Jobs that may wait for a free worker before new ones are refused with 503 (default 32: a few seconds' work). */
  maxQueued?: number;
}

export interface PasswordHasher {
  hash(password: string, cost: number): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
  /** Stops the workers and fails the work they had (tests); later calls start new ones. */
  close(): Promise<void>;
}

type Job = { op: "hash"; password: string; cost: number } | { op: "compare"; password: string; hash: string };

interface Pending {
  job: Job;
  resolve: (result: string | boolean) => void;
  reject: (error: Error) => void;
}

/**
 * The worker's code, run as a CommonJS script (`eval`), so the build needs no second entry point. It
 * loads bcryptjs from the path the main thread resolved, and answers one job at a time.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const bcrypt = require(workerData.bcryptPath);
parentPort.on("message", (job) => {
  try {
    const result = job.op === "hash" ? bcrypt.hashSync(job.password, job.cost) : bcrypt.compareSync(job.password, job.hash);
    parentPort.postMessage({ result });
  } catch (error) {
    parentPort.postMessage({ error: String((error && error.message) || error) });
  }
});
`;

const busy = () =>
  new HttpError(503, "SERVICE_UNAVAILABLE", "Too many people are signing in right now. Please try again in a moment.");

export function createPasswordHasher(options: PasswordHasherOptions = {}): PasswordHasher {
  const size = Math.max(1, options.workers ?? Math.min(2, availableParallelism() - 1));
  const maxQueued = options.maxQueued ?? 32;
  const bcryptPath = createRequire(import.meta.url).resolve("bcryptjs");

  const idle: Worker[] = [];
  const running = new Map<Worker, Pending>();
  const queue: Pending[] = [];
  let started = 0;

  function start(): Worker {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath } });
    started++;
    worker.on("message", (message: { result?: string | boolean; error?: string }) => {
      const pending = running.get(worker);
      running.delete(worker);
      // An idle worker never keeps the process (or a test run) alive; a busy one does, until it answers.
      worker.unref();
      if (pending) {
        if (message.error !== undefined) pending.reject(new Error(message.error));
        else pending.resolve(message.result as string | boolean);
      }
      idle.push(worker);
      dispatch();
    });
    const lost = (error: Error) => {
      started--;
      const index = idle.indexOf(worker);
      if (index !== -1) idle.splice(index, 1);
      const pending = running.get(worker);
      running.delete(worker);
      pending?.reject(error);
      dispatch();
    };
    worker.once("error", lost);
    worker.once("exit", (code) => {
      if (running.has(worker) || idle.includes(worker)) lost(new Error(`The password worker stopped (exit code ${code})`));
    });
    return worker;
  }

  function dispatch(): void {
    while (queue.length > 0) {
      const worker = idle.pop() ?? (started < size ? start() : undefined);
      if (!worker) return;
      const pending = queue.shift() as Pending;
      running.set(worker, pending);
      worker.ref();
      worker.postMessage(pending.job);
    }
  }

  function run(job: Job): Promise<string | boolean> {
    // `queue` holds only jobs no worker is free for: dispatch() runs after every change.
    if (queue.length >= maxQueued) return Promise.reject(busy());
    return new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      dispatch();
    });
  }

  return {
    hash: async (password, cost) => (await run({ op: "hash", password, cost })) as string,
    compare: async (password, hash) => (await run({ op: "compare", password, hash })) as boolean,
    async close() {
      const workers = [...idle, ...Array.from(running.keys())];
      idle.length = 0;
      const closed = new Error("The password hasher was closed");
      for (const pending of [...Array.from(running.values()), ...queue.splice(0)]) pending.reject(closed);
      running.clear();
      started = 0;
      await Promise.all(workers.map((worker) => worker.terminate()));
    },
  };
}

/** The app's hasher: every password hash and check goes through it (services/auth.ts). */
export const passwordHasher = createPasswordHasher();

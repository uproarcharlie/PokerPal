import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { Request, RequestHandler, Response } from "express";
import rateLimit, {
  ipKeyGenerator,
  type AugmentedRequest,
  type RateLimitExceededEventHandler,
  type RateLimitInfo,
  type Store,
} from "express-rate-limit";
import { idSchema } from "@shared/api/common";
import type { AppEnv } from "../config/env";
import { HttpError } from "./errors";
import { isKnownDevice } from "./known-device";
import { sameSecret } from "./signing";

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, checked 2026-10). Production is
 * visitor → Cloudflare → Railway edge → app, so with `trust proxy 1` req.ip is a Cloudflare edge
 * address and the visitor is in CF-Connecting-IP (CC-04).
 */
export const CLOUDFLARE_IP_RANGES = {
  v4: [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ],
  v6: [
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
  ],
} as const;

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_IP_RANGES.v4) {
  const [network, prefix] = range.split("/");
  cloudflare.addSubnet(network, Number(prefix), "ipv4");
}
for (const range of CLOUDFLARE_IP_RANGES.v6) {
  const [network, prefix] = range.split("/");
  cloudflare.addSubnet(network, Number(prefix), "ipv6");
}

/** "::ffff:1.2.3.4" (an IPv4 peer on a dual-stack socket) → "1.2.3.4". */
function normaliseIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

export function isCloudflareIp(ip: string): boolean {
  const address = normaliseIp(ip);
  const family = isIP(address);
  return family !== 0 && cloudflare.check(address, family === 4 ? "ipv4" : "ipv6");
}

declare global {
  namespace Express {
    interface Request {
      /** The visitor's address, worked out once by `identifyVisitor` (see clientIp). */
      visitorIp?: string;
    }
  }
}

/**
 * The header our Cloudflare zone adds to every request it forwards (a Transform Rule), carrying
 * CLOUDFLARE_ORIGIN_SECRET. Coming from a Cloudflare address only proves a request left Cloudflare's
 * network, not that it went through our zone: another customer's Worker can call the Railway origin
 * from a Cloudflare address with any CF-Connecting-IP it likes (P2REV0-03). The secret proves it.
 */
export const ORIGIN_AUTH_HEADER = "x-origin-auth";

const warned = new Set<string>();

/** Logs `message` the first time `key` comes up in this process, so a flood cannot flood the log. */
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/**
 * The visitor's address: CF-Connecting-IP when the request reached us through our Cloudflare zone,
 * else req.ip. The header is believed only from a Cloudflare peer and, once CLOUDFLARE_ORIGIN_SECRET
 * is set, only with that secret in X-Origin-Auth (compared in constant time), so nobody calling the
 * Railway origin directly or through someone else's Cloudflare account can pick their own rate-limit
 * key. Without the secret (not yet configured) the Cloudflare-address check alone applies, as before.
 * When the header is not believed this keys by req.ip, which is what the limiters did before
 * Phase 2; the first such request is logged so it can be spotted.
 */
export function resolveClientIp(req: Request, originSecret?: string): string {
  const peer = normaliseIp(req.ip ?? req.socket.remoteAddress ?? "");
  const header = req.get("cf-connecting-ip")?.trim();
  if (header && isIP(header)) {
    if (!isCloudflareIp(peer)) {
      warnOnce("peer", `Ignoring CF-Connecting-IP from non-Cloudflare peer ${peer}; rate limits key on the peer address`);
    } else if (originSecret && !sameSecret(req.get(ORIGIN_AUTH_HEADER) ?? "", originSecret)) {
      warnOnce("origin-auth", `Ignoring CF-Connecting-IP without a valid ${ORIGIN_AUTH_HEADER} header (peer ${peer}); rate limits key on the peer address`);
    } else {
      return normaliseIp(header);
    }
  }
  return peer || "unknown";
}

/**
 * Mount first: works out each request's visitor address once, with the app's
 * CLOUDFLARE_ORIGIN_SECRET, for the limiters and the audit log. In production it says at boot when
 * the secret is not set.
 */
export function identifyVisitor(env: Pick<AppEnv, "NODE_ENV" | "CLOUDFLARE_ORIGIN_SECRET">): RequestHandler {
  if (env.NODE_ENV === "production" && !env.CLOUDFLARE_ORIGIN_SECRET) {
    console.warn(
      `CLOUDFLARE_ORIGIN_SECRET is not set: CF-Connecting-IP is believed from any Cloudflare address (see DEPLOYMENT.md)`,
    );
  }
  return (req, _res, next) => {
    req.visitorIp = resolveClientIp(req, env.CLOUDFLARE_ORIGIN_SECRET);
    next();
  };
}

/** The visitor's address, as identifyVisitor worked it out (resolved here, without the secret, on an app that does not mount it). */
export function clientIp(req: Request): string {
  return req.visitorIp ?? resolveClientIp(req);
}

/** The rate-limit key for a visitor: their IPv4 address, or their IPv6 /56. */
export function visitorKey(req: Request): string {
  return ipKeyGenerator(clientIp(req), 56);
}

/** A signed-in user's own bucket, so a room of phones on the venue's address never throttles the TD (and vice versa). */
export function userOrVisitorKey(req: Request): string {
  return req.user ? `user:${req.user.id}` : visitorKey(req);
}

/**
 * The GET endpoints the client polls: the public tournament view (the tournament, so a phone sees
 * the TD's pool changes and the lock (MONEY-P2REV-02), its registrations and activity every 5 s, and
 * the prize pool that changes with them), the TD's desk pages (pending and confirmed registrations,
 * pending actions every 3 s), and Phase 4's live screens: the TV clock and the TD's clock panel
 * (the display, every 3–5 s), the TD's seating (10 s), the seat finder (15 s) and the season
 * leaderboard behind the TV's QR code (60 s). They are counted by `live`, not `globalApi`, so polling
 * never uses up the budget that page loads, sign-ins and QR sign-ups draw on. Any endpoint the client
 * starts polling belongs here. Case-insensitive, as Express's routing is.
 */
const LIVE_API_PATHS: readonly RegExp[] = [
  /^\/api\/tournaments\/[^/]+\/?$/i,
  /^\/api\/tournaments\/[^/]+\/(?:registrations|activity|prize-pool|pending-registrations|confirmed-registrations|pending-actions|seating)\/?$/i,
  /^\/api\/public\/tournaments\/[^/]+\/(?:display|seating)\/?$/i,
  /^\/api\/public\/seasons\/[^/]+\/leaderboard\/?$/i,
];

export function isLiveApiRequest(req: Pick<Request, "method" | "baseUrl" | "path">): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const path = req.baseUrl + req.path;
  return LIVE_API_PATHS.some((pattern) => pattern.test(path));
}

/**
 * The TD's live writes during play (phase4-contracts §5): clock actions, the clock's structure,
 * display and TV key, tables, seating (and its undo) and early birds. Counted by `liveOps`, per
 * signed-in user, not by `globalApi`: a room of phones on the venue's address must never leave the TD
 * unable to pause the clock or move a player. Anyone not signed in (a TV running the clock with its
 * clock key) is still counted, per visitor.
 */
const LIVE_OPS_PATHS: readonly RegExp[] = [
  /^\/api\/tournaments\/[^/]+\/(?:clock(?:\/(?:actions|display|key))?|seating\/(?:setup|draw|assign|unseat|balance|final-table|undo)|tables(?:\/[^/]+(?:\/break)?)?|early-birds)\/?$/i,
];

export function isLiveOpsRequest(req: Pick<Request, "method" | "baseUrl" | "path">): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return false;
  const path = req.baseUrl + req.path;
  return LIVE_OPS_PATHS.some((pattern) => pattern.test(path));
}

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Requests per key per window (15 minutes unless RATE_LIMIT_WINDOWS says otherwise). */
export const RATE_LIMITS = {
  /** Every /api request that is not live polling, failures included, per visitor (a venue shares one address). */
  globalApi: 3000,
  /** Failed sign-ins and sign-ups per visitor and email (successes are not counted): SEC-10. */
  auth: 10,
  /** Failed sign-ins and sign-ups per visitor, whatever the email: stops one address trying many accounts. */
  authVisitor: 30,
  /**
   * Failed sign-ins per email, from every address together: stops many addresses trying one account.
   * It slows a distributed attack to two guesses a minute. A browser that has signed in to the account
   * before is not held to it (known-device.ts), so nobody can lock the owner out by failing on purpose.
   */
  authAccount: 30,
  /** Sign-ups per visitor per hour, successful ones included (each is a bcrypt hash and a new account). */
  signUp: 5,
  /**
   * Player self-service writes (create player, sign up, request an action, upload a photo), per
   * signed-in account or else per visitor, and per tournament for sign-ups and requests. Sized for a
   * full room on one venue Wi-Fi: 60 new players with photos are about 120 writes in the shared
   * bucket, and each tournament's sign-ups plus every re-buy, add-on and knockout request about 150.
   * RATE_LIMIT_PUBLIC_WRITE overrides it.
   */
  publicWrite: 300,
  /** Image uploads (any kind), per signed-in account or else per visitor: each one is decoded and stored for good. */
  upload: 100,
  /** Changes to a club's staff, per signed-in account (each addition looks an account up by email). */
  staffChange: 20,
  /** New clubs per signed-in account per hour (only clubs actually created count): each is public on the home page. */
  clubCreate: 5,
  /** New clubs per visitor per hour, whatever the account: stops one address opening many accounts to make many clubs. */
  clubCreateVisitor: 10,
  /** New tournaments per signed-in account per hour (only ones actually created count): upcoming ones are public on the home page. */
  tournamentCreate: 30,
  /** New tournaments per visitor per hour, whatever the account. */
  tournamentCreateVisitor: 60,
  /**
   * Every request that checks or hashes a password (sign-in, sign-up, change-password), per visitor,
   * successful ones included: each is a cost-12 bcrypt run, so this bounds the hashing one address
   * can ask for however many accounts it signs in to (SEC-P2REV-01).
   */
  passwordVisitor: 60,
  /**
   * Successful sign-ins per account, from every address together. Failures are `authAccount`'s; only
   * the account's own password produces a success, so nobody can use this one up for someone else.
   */
  signInAccount: 20,
  /** Password changes per signed-in account, every attempt counted (each checks the current password). */
  passwordChange: 10,
  /**
   * Live polling, per signed-in user or else per visitor. One open public view polls about 360 times in
   * 15 minutes and a TD's desk page about 600, so this covers some 27 phones on one venue address
   * watching non-stop while still stopping a runaway client (about 11 requests a second).
   * RATE_LIMIT_LIVE overrides it.
   */
  live: 10_000,
  /**
   * The TD's live writes (isLiveOpsRequest), per signed-in user or else per visitor. A busy night is a
   * few hundred clock and seating actions; this still stops a runaway client (under 2 a second).
   */
  liveOps: 1_500,
} as const;

export type RateLimiterName = keyof typeof RATE_LIMITS;
export type RateLimiters = Record<RateLimiterName, RequestHandler>;

/** Windows other than RATE_LIMIT_WINDOW_MS. */
export const RATE_LIMIT_WINDOWS: Partial<Record<RateLimiterName, number>> = {
  signUp: 60 * 60 * 1000,
  clubCreate: 60 * 60 * 1000,
  clubCreateVisitor: 60 * 60 * 1000,
  tournamentCreate: 60 * 60 * 1000,
  tournamentCreateVisitor: 60 * 60 * 1000,
};

export interface RateLimiterOptions {
  /** Overrides the env's choice (RATE_LIMITS_ENABLED, else on except under NODE_ENV=test); limiter tests turn it on. */
  enabled?: boolean;
  /** Lower limits for tests. */
  limits?: Partial<Record<RateLimiterName, number>>;
  /** Each limiter's counter store (default: express-rate-limit's in-memory store); tests use it to see the keys. */
  storeFor?: (name: RateLimiterName) => Store;
}

/**
 * What the limiters read from the config. `RATE_LIMITS_ENABLED` (unset = decide by NODE_ENV) lets a
 * production-mode run that is not production, such as the e2e server, turn them off; the
 * `RATE_LIMIT_*` overrides raise or lower one limit without touching the others.
 */
export type RateLimitEnv = Pick<AppEnv, "NODE_ENV" | "RATE_LIMITS_ENABLED"> &
  Partial<Pick<AppEnv, "RATE_LIMIT_PUBLIC_WRITE" | "RATE_LIMIT_LIVE" | "SESSION_SECRET">>;

export function rateLimitsEnabled(env: RateLimitEnv, options: RateLimiterOptions = {}): boolean {
  return options.enabled ?? env.RATE_LIMITS_ENABLED ?? env.NODE_ENV !== "test";
}

/** Each limit as configured: a test's override, else the env's, else RATE_LIMITS. */
export function rateLimitsFor(env: RateLimitEnv, options: RateLimiterOptions = {}): Record<RateLimiterName, number> {
  const fromEnv: Partial<Record<RateLimiterName, number>> = {
    publicWrite: env.RATE_LIMIT_PUBLIC_WRITE,
    live: env.RATE_LIMIT_LIVE,
  };
  const names = Object.keys(RATE_LIMITS) as RateLimiterName[];
  return Object.fromEntries(names.map((name) => [name, options.limits?.[name] ?? fromEnv[name] ?? RATE_LIMITS[name]])) as Record<
    RateLimiterName,
    number
  >;
}

const passThrough: RequestHandler = (_req, _res, next) => next();

/**
 * Answers a refused request with a 429 through the central error handler, which does not log 429s:
 * only the first refusal per key and window is logged here, so a flood cannot flood the log.
 */
function refuse(name: RateLimiterName, message: string): RateLimitExceededEventHandler {
  return (req, res, next, options) => {
    const info: RateLimitInfo | undefined = (req as AugmentedRequest)[options.requestPropertyName];
    if (info && info.used === info.limit + 1) {
      const who = req.user ? `user ${req.user.id} at ${clientIp(req)}` : clientIp(req);
      console.warn(`Rate limit "${name}" reached by ${who} (${req.method} ${req.originalUrl.split("?", 1)[0]})`);
    }
    res.locals.refusedBy = name;
    next(new HttpError(429, "RATE_LIMITED", message));
  };
}

/**
 * For the limiters that count failures only: a request counts as a failure when it failed for itself,
 * not when another limiter after this one turned it away (a visitor retrying an account that is
 * already held back must not use up the whole venue's sign-in budget too).
 */
function failedOnItsOwn(name: RateLimiterName) {
  return (_req: Request, res: Response): boolean => {
    const refusedBy: unknown = res.locals.refusedBy;
    return res.statusCode < 400 || (refusedBy !== undefined && refusedBy !== name);
  };
}

/** For a limiter that counts every attempt: false (take the count back) when another limiter refused the request first. */
function notRefusedByAnother(name: RateLimiterName, res: Response): boolean {
  const refusedBy: unknown = res.locals.refusedBy;
  return refusedBy === undefined || refusedBy === name;
}

/** The longest email the sign-in and sign-up schemas accept (RFC 5321). */
const EMAIL_MAX = 254;

/**
 * The email a sign-in or sign-up names, trimmed and lower-cased; "" when there is none, or when it is
 * longer than any account's could be (it can never match one, and the validator refuses it).
 */
export function bodyEmail(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== "string") return "";
  const normalised = email.trim().toLowerCase();
  return normalised.length <= EMAIL_MAX ? normalised : "";
}

/**
 * The rate-limit key part for the email in the body: a fixed-size digest, never the caller's text, so
 * the in-memory counters hold a few dozen bytes per key whatever was sent (P2REV0-SEC-01).
 */
function emailKey(req: Request): string {
  const email = bodyEmail(req);
  return email ? createHash("sha256").update(email).digest("base64url") : "";
}

/** The route's `:id` for a per-resource bucket, only when it is a well-formed id; "" otherwise (a 404 is coming). */
function resourceKey(req: Request): string {
  const id: unknown = req.params?.id;
  return typeof id === "string" && idSchema.safeParse(id).success ? id : "";
}

/**
 * Every limiter's key, from the request. None holds text the caller chose beyond a validated id: the
 * counters live in memory for up to two windows, so a key built from a raw body field or URL segment
 * would let anyone fill the heap (P2REV0-SEC-01).
 */
export const RATE_LIMIT_KEYS = {
  visitor: visitorKey,
  userOrVisitor: userOrVisitorKey,
  visitorAndEmail: (req: Request) => `${visitorKey(req)}|${emailKey(req)}`,
  email: (req: Request) => `email:${emailKey(req)}`,
  userOrVisitorAndResource: (req: Request) => `${userOrVisitorKey(req)}|${resourceKey(req)}`,
} as const;

const FAILED_ATTEMPTS = "Too many failed attempts. Please wait 15 minutes and try again.";

/**
 * One set per app (each limiter keeps its own in-memory counts, which reset when the process
 * restarts). The app mounts two of them on /api itself:
 * - `globalApi` ahead of the session middleware, so a flood is turned away before it reaches the
 *   session store. It skips live polling and the TD's live writes.
 * - `live` after the signed-in user is attached, so each user has their own bucket. It counts only
 *   live polling. Route modules never mount it.
 * - `liveOps` beside it, counting only the TD's live writes (clock, seating), per user. Route modules
 *   never mount it either.
 * Route modules mount the rest: `passwordVisitor`, `authVisitor`, `auth`, `authAccount` and
 * `signInAccount` on sign-in, `passwordVisitor`, `signUp`, `authVisitor` and `auth` on sign-up, and
 * `passwordVisitor` and `passwordChange` on change-password, in that order (after express.json: some
 * key on a digest of the email in the body), so a visitor who is already turned away adds no new
 * per-email counter;
 * `publicWrite` on every player self-service write, `upload` on every upload, `staffChange` on club
 * staff changes, `clubCreate` and `clubCreateVisitor` on opening a club, and `tournamentCreate` and
 * `tournamentCreateVisitor` on creating a tournament. Nobody skips
 * `publicWrite`: any account can be opened in seconds, so a signed-in user gets a bucket of their own
 * (a TD at the desk never shares the venue's) rather than none.
 */
export function createRateLimiters(env: RateLimitEnv, options: RateLimiterOptions = {}): RateLimiters {
  const names = Object.keys(RATE_LIMITS) as RateLimiterName[];
  if (!rateLimitsEnabled(env, options)) {
    return Object.fromEntries(names.map((name) => [name, passThrough])) as RateLimiters;
  }
  const limits = rateLimitsFor(env, options);
  const common = (name: RateLimiterName) =>
    ({
      windowMs: RATE_LIMIT_WINDOWS[name] ?? RATE_LIMIT_WINDOW_MS,
      limit: limits[name],
      standardHeaders: "draft-7",
      legacyHeaders: false,
      ...(options.storeFor ? { store: options.storeFor(name) } : {}),
    }) as const;
  const failuresOnly = (name: RateLimiterName) => ({ skipSuccessfulRequests: true, requestWasSuccessful: failedOnItsOwn(name) });

  return {
    globalApi: rateLimit({
      ...common("globalApi"),
      skip: (req) => isLiveApiRequest(req) || isLiveOpsRequest(req),
      keyGenerator: RATE_LIMIT_KEYS.visitor,
      handler: refuse("globalApi", "Too many requests, please try again later."),
    }),
    auth: rateLimit({
      ...common("auth"),
      ...failuresOnly("auth"),
      keyGenerator: RATE_LIMIT_KEYS.visitorAndEmail,
      handler: refuse("auth", FAILED_ATTEMPTS),
    }),
    authVisitor: rateLimit({
      ...common("authVisitor"),
      ...failuresOnly("authVisitor"),
      keyGenerator: RATE_LIMIT_KEYS.visitor,
      handler: refuse("authVisitor", FAILED_ATTEMPTS),
    }),
    authAccount: rateLimit({
      ...common("authAccount"),
      ...failuresOnly("authAccount"),
      skip: (req) => bodyEmail(req) === "" || isKnownDevice(req, env, bodyEmail(req)),
      keyGenerator: RATE_LIMIT_KEYS.email,
      handler: refuse("authAccount", "Too many failed sign-ins for this account. Please wait 15 minutes and try again."),
    }),
    signUp: rateLimit({
      ...common("signUp"),
      keyGenerator: RATE_LIMIT_KEYS.visitor,
      handler: refuse("signUp", "Too many accounts created from this network. Please try again later."),
    }),
    publicWrite: rateLimit({
      ...common("publicWrite"),
      // Sign-ups and requests count per tournament (`:id`), so one busy table never blocks another.
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitorAndResource,
      handler: refuse("publicWrite", "Too many requests from this network, please try again later."),
    }),
    upload: rateLimit({
      ...common("upload"),
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitor,
      handler: refuse("upload", "Too many uploads from this network, please try again later."),
    }),
    staffChange: rateLimit({
      ...common("staffChange"),
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitor,
      handler: refuse("staffChange", "Too many staff changes, please try again later."),
    }),
    clubCreate: rateLimit({
      ...common("clubCreate"),
      skipFailedRequests: true,
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitor,
      handler: refuse("clubCreate", "You have opened several clubs in the last hour. Please try again later."),
    }),
    clubCreateVisitor: rateLimit({
      ...common("clubCreateVisitor"),
      skipFailedRequests: true,
      keyGenerator: RATE_LIMIT_KEYS.visitor,
      handler: refuse("clubCreateVisitor", "Too many clubs opened from this network. Please try again later."),
    }),
    tournamentCreate: rateLimit({
      ...common("tournamentCreate"),
      skipFailedRequests: true,
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitor,
      handler: refuse("tournamentCreate", "You have created many tournaments in the last hour. Please try again later."),
    }),
    tournamentCreateVisitor: rateLimit({
      ...common("tournamentCreateVisitor"),
      skipFailedRequests: true,
      keyGenerator: RATE_LIMIT_KEYS.visitor,
      handler: refuse("tournamentCreateVisitor", "Too many tournaments created from this network. Please try again later."),
    }),
    passwordVisitor: rateLimit({
      ...common("passwordVisitor"),
      // Every attempt counts, except one another limiter turned away before any password was checked.
      skipFailedRequests: true,
      requestWasSuccessful: (_req, res) => notRefusedByAnother("passwordVisitor", res),
      keyGenerator: RATE_LIMIT_KEYS.visitor,
      handler: refuse("passwordVisitor", "Too many sign-in attempts from this network. Please wait 15 minutes and try again."),
    }),
    signInAccount: rateLimit({
      ...common("signInAccount"),
      skipFailedRequests: true,
      skip: (req) => bodyEmail(req) === "",
      keyGenerator: RATE_LIMIT_KEYS.email,
      handler: refuse("signInAccount", "This account has signed in many times in the last 15 minutes. Please wait and try again."),
    }),
    passwordChange: rateLimit({
      ...common("passwordChange"),
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitor,
      handler: refuse("passwordChange", "Too many password changes. Please wait 15 minutes and try again."),
    }),
    live: rateLimit({
      ...common("live"),
      skip: (req) => !isLiveApiRequest(req),
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitor,
      handler: refuse("live", "Too many requests, please try again later."),
    }),
    liveOps: rateLimit({
      ...common("liveOps"),
      skip: (req) => !isLiveOpsRequest(req),
      keyGenerator: RATE_LIMIT_KEYS.userOrVisitor,
      handler: refuse("liveOps", "Too many changes, please try again in a moment."),
    }),
  };
}

import type { Request, RequestHandler, Response } from "express";
import multer from "multer";
import {
  ACCEPTED_IMAGE_TYPES,
  HEIC_IMAGE_TYPES,
  HEIC_MESSAGE,
  MAX_IMAGE_UPLOAD_BYTES,
  UNSUPPORTED_TYPE_MESSAGE,
} from "@shared/domain/images";
import { HttpError } from "../http/errors";
import { visitorKey } from "../http/rate-limits";

const accepted: ReadonlySet<string> = new Set(ACCEPTED_IMAGE_TYPES);
const heic: ReadonlySet<string> = new Set(HEIC_IMAGE_TYPES);

/**
 * Uploads are buffered in memory (at most 5 MiB) and never written as received: the image pipeline
 * checks the bytes, re-encodes them and stores only its own WebP variants. The declared type is a
 * cheap first filter so obvious non-images are refused before their bytes are read.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 4 * 1024 },
  fileFilter: (_req, file, accept) => {
    if (accepted.has(file.mimetype)) return accept(null, true);
    accept(new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", heic.has(file.mimetype) ? HEIC_MESSAGE : UNSUPPORTED_TYPE_MESSAGE));
  },
});

const parseImageField = upload.single("image");

const TOO_LARGE_MESSAGE = `That file is too large: images can be at most ${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)} MB.`;

export interface UploadIntakeLimits {
  /** Bodies being read at once, across every upload route and caller (each up to 5 MiB in memory). */
  maxInFlight: number;
  /** Bodies being read at once for one signed-in account (they count against its address as well). */
  maxPerAccount: number;
  /**
   * Bodies being read at once from one address, signed in or not. A venue's phones share one address
   * (an IPv4 NAT or an IPv6 /56), so this is several, not one per phone, and well below maxInFlight,
   * so one address can never hold every slot, however many accounts it signs in to (TN-REV2-01,
   * SEC-P2REV-02).
   */
  maxPerAddress: number;
  /** How long a body may take to arrive before the upload is refused (408) and the connection closed. */
  bodyTimeoutMs: number;
  /**
   * After `slowGraceMs`, a body must keep arriving at this many bytes a second on average (counted
   * from the end of the grace period), or it is refused (408) and its slot freed: a sender trickling a
   * byte now and then cannot hold a slot for the whole timeout. 0 turns the check off.
   */
  minBytesPerSecond: number;
  slowGraceMs: number;
}

/**
 * About 60 MB of bodies being read at once at most; a 5 MB photo over a slow venue Wi-Fi still has a
 * minute, and anything slower than 8 KB a second after the first 10 seconds is not a phone uploading
 * a photo. Three addresses at least are needed to fill every slot.
 */
export const UPLOAD_INTAKE_LIMITS: UploadIntakeLimits = {
  maxInFlight: 12,
  maxPerAccount: 2,
  maxPerAddress: 5,
  bodyTimeoutMs: 60_000,
  minBytesPerSecond: 8 * 1024,
  slowGraceMs: 10_000,
};

/** How often a body's progress is checked against minBytesPerSecond. */
const PROGRESS_CHECK_MS = 1_000;

const intakeBusy = () =>
  new HttpError(503, "SERVICE_UNAVAILABLE", "Too many pictures are being uploaded right now. Please try again in a moment.");
const accountBusy = () => new HttpError(429, "RATE_LIMITED", "Another picture from you is still uploading. Please wait for it to finish.");
const addressBusy = () =>
  new HttpError(429, "RATE_LIMITED", "Several pictures are uploading from this network right now. Please try again in a moment.");
const timedOut = () => new HttpError(408, "UPLOAD_TIMEOUT", "The picture took too long to arrive. Please try again on a better connection.");

/** Who an upload's slot is counted against: always their address, and their account too when signed in. */
export interface UploadCaller {
  /** The visitor key (an IPv4 address or an IPv6 /56). */
  address: string;
  /** The signed-in account, if any. */
  account?: string;
}

const uploadCaller = (req: Request): UploadCaller => ({ address: visitorKey(req), account: req.user?.id });

export interface UploadIntake {
  /**
   * Takes a slot for the upload, or refuses it (503 when every slot is taken, 429 when the caller's
   * own are) before anything else is counted or read. Mount it ahead of the rate limiters, so a
   * refusal here never uses up the venue's upload and self-service budgets; the slot is given back
   * when the request ends, however it ends.
   */
  admit: RequestHandler;
  /**
   * Reads the multipart body with one image in field `image` (as `req.file`) and its text fields (as
   * `req.body`), in the slot `admit` took (taking one itself when mounted alone). Every refusal goes
   * to the central error handler: 415 for a type that is not allowed, 413 for a file over the limit,
   * 408 for a body that does not arrive in time, 400 for anything else malformed.
   */
  receive: RequestHandler;
}

/**
 * Upload intake. multer holds a body in memory while it arrives, so how many are read at once is
 * bounded here, not only how many are rendered (P2REV0-04): past `maxInFlight` bodies an upload is
 * refused at once with 503, past the account's or the address's own share with 429, before a byte is
 * read; and a body that has not arrived within `bodyTimeoutMs`, or arrives slower than
 * `minBytesPerSecond` once `slowGraceMs` is up, is refused with 408 and its connection closed, so a
 * slow sender cannot hold a slot (and its buffer) for long (SEC-P2REV-02). A slot is freed as soon as
 * the body is read, or the request ends.
 */
export function createUploadIntake(
  limits: UploadIntakeLimits = UPLOAD_INTAKE_LIMITS,
  callerOf: (req: Request) => UploadCaller = uploadCaller,
): UploadIntake {
  let inFlight = 0;
  const perKey = new Map<string, number>();
  const slots = new WeakMap<Request, () => void>();
  const held = (key: string) => perKey.get(key) ?? 0;

  /** Takes a slot for `req` (released when the response closes), or the refusal. */
  function reserve(req: Request, res: Response): HttpError | undefined {
    if (slots.has(req)) return undefined;
    const { address, account } = callerOf(req);
    const addressKey = `address:${address}`;
    const accountKey = account === undefined ? undefined : `account:${account}`;
    if (inFlight >= limits.maxInFlight) return intakeBusy();
    if (accountKey && held(accountKey) >= limits.maxPerAccount) return accountBusy();
    if (held(addressKey) >= limits.maxPerAddress) return addressBusy();
    const keys = accountKey ? [addressKey, accountKey] : [addressKey];
    inFlight++;
    for (const key of keys) perKey.set(key, held(key) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight--;
      for (const key of keys) {
        const left = held(key) - 1;
        if (left > 0) perKey.set(key, left);
        else perKey.delete(key);
      }
    };
    slots.set(req, release);
    res.once("close", release);
    return undefined;
  }

  const admit: RequestHandler = (req, res, next) => next(reserve(req, res));

  const receive: RequestHandler = (req, res, next) => {
    const refused = reserve(req, res);
    if (refused) return next(refused);
    const release = slots.get(req) ?? (() => undefined);

    const startedAt = Date.now();
    let received = 0;
    let settled = false;
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(progress);
      release();
      next(error);
    };
    /** Stops reading, answers 408, then drops the connection: the rest of the body is never wanted. */
    const giveUp = () => {
      if (settled) return;
      req.unpipe();
      res.set("Connection", "close");
      res.once("finish", () => req.destroy());
      settle(timedOut());
    };
    const deadline = setTimeout(giveUp, limits.bodyTimeoutMs);
    const progress = setInterval(() => {
      const late = Date.now() - startedAt - limits.slowGraceMs;
      if (limits.minBytesPerSecond > 0 && late > 0 && received < (late / 1000) * limits.minBytesPerSecond) giveUp();
    }, Math.min(PROGRESS_CHECK_MS, Math.max(limits.slowGraceMs, 10)));
    res.once("close", () => {
      clearTimeout(deadline);
      clearInterval(progress);
    });

    parseImageField(req, res, (error?: unknown) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return settle(new HttpError(413, "FILE_TOO_LARGE", TOO_LARGE_MESSAGE));
      }
      settle(error);
    });
    // Counted beside multer's own reading (a second listener changes nothing for it).
    req.on("data", (chunk: Buffer) => (received += chunk.length));
  };

  return { admit, receive };
}

/** The app's upload intake, with UPLOAD_INTAKE_LIMITS shared by every upload route. */
const uploadIntake = createUploadIntake();
export const admitImageUpload: RequestHandler = uploadIntake.admit;
export const receiveImageUpload: RequestHandler = uploadIntake.receive;

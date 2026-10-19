import { STATUS_CODES } from "node:http";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody, ErrorCode } from "@shared/api/errors";

/**
 * An error a handler throws (or passes to `next`) to answer with a specific status and code. The
 * message is shown to people, so it must never carry internals.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, code: ErrorCode = "VALIDATION", details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthenticated = (message = "Authentication required") => new HttpError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You don't have permission to do that") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (code: ErrorCode, message: string, details?: unknown) => new HttpError(409, code, message, details);

/** A ZodError as an HttpError: 400 VALIDATION with the zod issues (path, message, code) as details. */
export function validationError(error: ZodError, message = "Invalid request"): HttpError {
  return new HttpError(400, "VALIDATION", message, error.issues);
}

/**
 * Unique constraints with a friendlier answer than a bare CONFLICT. Both names of the clubs.slug
 * constraint are listed: the live databases and drizzle name it differently.
 */
const UNIQUE_VIOLATIONS: Readonly<Record<string, { code: ErrorCode; message: string }>> = {
  clubs_slug_key: { code: "SLUG_TAKEN", message: "That club URL is already taken" },
  clubs_slug_unique: { code: "SLUG_TAKEN", message: "That club URL is already taken" },
  users_email_unique: { code: "EMAIL_TAKEN", message: "An account with that email already exists" },
  uq_club_managers_club_user: { code: "ALREADY_MANAGER", message: "That person already manages this club" },
};

interface PgErrorLike {
  code: string;
  constraint?: string;
}

/** node-postgres DatabaseError fields, whether thrown directly or wrapped (e.g. by drizzle) as `cause`. */
function pgError(error: unknown): PgErrorLike | undefined {
  for (let current = error, depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; severity?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code) && "severity" in candidate) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

function fromPgError(error: PgErrorLike): HttpError | undefined {
  switch (error.code) {
    case "23505": {
      const known = error.constraint ? UNIQUE_VIOLATIONS[error.constraint] : undefined;
      return known
        ? new HttpError(409, known.code, known.message)
        : new HttpError(409, "CONFLICT", "That conflicts with an existing record");
    }
    case "23503":
      return new HttpError(409, "FK_VIOLATION", "A related record is missing or still in use");
    case "23514":
      return new HttpError(400, "CHECK_VIOLATION", "That value is not allowed");
    case "22P02":
    case "22003":
    case "22007":
    case "22008":
      return new HttpError(400, "VALIDATION", "A value is malformed or out of range");
    // A NUL byte (%00 in a path or query) or text the database cannot store: the caller's input, not a fault (P2REV0-07).
    case "22021":
    case "22P05":
      return new HttpError(400, "VALIDATION", "A value contains characters that are not allowed");
    case "40001":
    case "40P01":
      return new HttpError(409, "RETRY", "Another change happened at the same time; please try again");
    default:
      return undefined;
  }
}

interface MulterErrorLike {
  name: "MulterError";
  code: string;
}

function isMulterError(error: unknown): error is MulterErrorLike {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "MulterError";
}

function fromMulterError(error: MulterErrorLike): HttpError {
  if (error.code === "LIMIT_FILE_SIZE") return new HttpError(413, "FILE_TOO_LARGE", "That file is too large");
  return new HttpError(400, "VALIDATION", "The upload is malformed");
}

const CODE_FOR_STATUS: Readonly<Record<number, ErrorCode>> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
};

/**
 * Client errors from Express's own middleware (body-parser, serve-static), which follow http-errors:
 * a 4xx `status` is kept, and its message is shown only with `expose: true` (serve-static's 404 for a
 * missing file is not exposed: its message names the path on disk). Malformed JSON gets its own code.
 */
function fromHttpErrorsLike(error: unknown): HttpError | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { type, status, statusCode, expose, message } = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (type === "entity.parse.failed") return new HttpError(400, "BAD_JSON", "The request body is not valid JSON");
  if (type === "entity.too.large") return new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large");
  const code = typeof status === "number" ? status : statusCode;
  if (typeof code !== "number" || code < 400 || code >= 500) return undefined;
  const safeMessage = expose === true && typeof message === "string" ? message : (STATUS_CODES[code] ?? "Bad Request");
  return new HttpError(code, CODE_FOR_STATUS[code] ?? "VALIDATION", safeMessage);
}

const INTERNAL = new HttpError(500, "INTERNAL", "Something went wrong on our side. Please try again.");

/**
 * Whatever was thrown, as the HttpError to answer with. Anything unrecognised is a 500 whose body
 * says nothing about the cause; the caller logs the original.
 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof ZodError) return validationError(error);
  if (isMulterError(error)) return fromMulterError(error);
  // Express's router throws this, with no `expose`, for a path parameter that is not valid percent-encoding.
  if (error instanceof URIError) return new HttpError(400, "VALIDATION", "The URL is malformed");
  const pg = pgError(error);
  if (pg) return fromPgError(pg) ?? INTERNAL;
  return fromHttpErrorsLike(error) ?? INTERNAL;
}

export function errorBody(error: HttpError): ApiErrorBody {
  return error.details === undefined
    ? { error: error.message, code: error.code }
    : { error: error.message, code: error.code, details: error.details };
}

/**
 * The central error handler, mounted last. Every error, thrown by an asyncHandler or passed to
 * `next(err)`, becomes `{ error, code, details? }` with the right status. 5xx are logged with the
 * original error; 4xx with one warning line, except 429s: the limiters log the first refusal per
 * visitor and window themselves, so a flood of refused requests does not flood the log.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    // Express's default handler closes a response that is already streaming.
    next(err);
    return;
  }

  const httpError = toHttpError(err);
  if (httpError.status >= 500) {
    console.error(`${req.method} ${req.originalUrl} failed:`, err);
  } else if (httpError.status !== 429) {
    console.warn(`${req.method} ${req.originalUrl} → ${httpError.status} ${httpError.code}: ${httpError.message}`);
  }

  res.status(httpError.status).json(errorBody(httpError));
};

/** Mounted after every API route: an unknown /api path is a JSON 404, never the SPA's index.html (BUG-19). */
export const apiNotFound: RequestHandler = (_req, _res, next) => {
  next(notFound("No such API endpoint"));
};

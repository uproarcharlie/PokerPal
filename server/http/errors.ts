import type { ErrorRequestHandler } from "express";

interface HttpErrorLike {
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * Last-resort handler for errors passed to `next(err)` (e.g. malformed JSON from
 * the body parser). Responds `{ message }` with the error's status, defaulting to 500.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    // Express's default handler closes a response that is already streaming.
    next(err);
    return;
  }

  const httpError: HttpErrorLike = typeof err === "object" && err !== null ? err : {};
  const status = httpError.status || httpError.statusCode || 500;
  const message = httpError.message || "Internal Server Error";

  if (status >= 500) {
    console.error("Unhandled error:", err);
  } else {
    console.warn(`Request error ${status}: ${message}`);
  }

  res.status(status).json({ message });
};

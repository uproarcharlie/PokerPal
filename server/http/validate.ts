import type { RequestHandler } from "express";
import type { z } from "zod";
import { validationError } from "./errors";

export interface ValidateOptions {
  /** The 400 message, e.g. "Invalid club data" (today's per-route wording). Default "Invalid request". */
  message?: string;
}

/**
 * Parse `value` with `schema`: the parsed (stripped, transformed) value, or an HttpError
 * 400 VALIDATION carrying the zod issues as `details`. For use inside handlers, and by the middleware below.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown, options: ValidateOptions = {}): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error, options.message);
  return result.data;
}

/**
 * Replace `req.body` with its parsed value, so the handler sees only the fields the schema allows.
 * Type the handler with `asyncHandler<Params, ResBody, z.output<typeof schema>>(...)`.
 */
export function validateBody<S extends z.ZodTypeAny>(schema: S, options?: ValidateOptions): RequestHandler {
  return (req, _res, next) => {
    req.body = parseOrThrow(schema, req.body ?? {}, options);
    next();
  };
}

/**
 * Replace `req.params` with its parsed value, for params that are more than an id (an image kind, a
 * pair of ids): a malformed one is 400 before anything else runs. A query string is parsed in the
 * handler with `parseOrThrow(schema, req.query)`, so its type comes from the schema with no generics.
 */
export function validateParams<S extends z.ZodTypeAny>(schema: S, options?: ValidateOptions): RequestHandler {
  return (req, _res, next) => {
    req.params = parseOrThrow(schema, req.params, options);
    next();
  };
}

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import type { ParsedQs } from "qs";

/**
 * Express 4 ignores the promise a handler returns, so a rejection would hang the request. This passes
 * it to `next`, where the central error handler answers. Route handlers just `throw` (HttpError for
 * expected outcomes) and never write their own try/catch for errors.
 */
export function asyncHandler<P = ParamsDictionary, ResBody = unknown, ReqBody = unknown, ReqQuery = ParsedQs>(
  handler: (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => Promise<unknown>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

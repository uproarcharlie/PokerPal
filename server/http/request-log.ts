import type { RequestHandler } from "express";
import { log } from "../vite";

/**
 * One log line per /api response: method, path, status and duration. Never the response body: it
 * holds players' and users' details, and stringifying every polled list on every request cost CPU
 * for an 80-character preview (SEC-31). Failed requests are also logged, with their code, by the
 * central error handler.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  const { method, path } = req;
  res.on("finish", () => {
    if (path.startsWith("/api")) log(`${method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
  });
  next();
};

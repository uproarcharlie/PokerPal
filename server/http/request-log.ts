import type { RequestHandler } from "express";
import { log } from "../vite";

const MAX_LINE_LENGTH = 80;

/** One log line per /api response: method, path, status, duration and a JSON preview. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown;

  const originalResJson = res.json;
  res.json = function (...args: Parameters<typeof originalResJson>) {
    capturedJsonResponse = args[0];
    return originalResJson.apply(res, args);
  };

  res.on("finish", () => {
    if (!path.startsWith("/api")) return;

    const duration = Date.now() - start;
    let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
    if (capturedJsonResponse) {
      logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
    }
    if (logLine.length > MAX_LINE_LENGTH) {
      logLine = logLine.slice(0, MAX_LINE_LENGTH - 1) + "…";
    }
    log(logLine);
  });

  next();
};

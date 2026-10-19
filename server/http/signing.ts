import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../config/env";

/**
 * Short server-signed values (a QR sign-up's token, a known-device mark): HMAC-SHA256 keyed by
 * SESSION_SECRET, so only this server can mint them. Each use names its own `purpose`, so a value
 * signed for one can never pass as another. Without SESSION_SECRET (allowed outside production) a
 * random key for this process is used, so values minted before a restart stop being accepted.
 */
let processKey: Buffer | undefined;

function signingKey(env: Pick<AppEnv, "SESSION_SECRET">): string | Buffer {
  return env.SESSION_SECRET ?? (processKey ??= randomBytes(32));
}

/** The signature of `parts` for `purpose`, base64url. Parts must not contain a newline. */
export function sign(env: Pick<AppEnv, "SESSION_SECRET">, purpose: string, ...parts: string[]): string {
  return createHmac("sha256", signingKey(env)).update([purpose, ...parts].join("\n")).digest("base64url");
}

/** Constant-time comparison of two signatures (or any two secrets). */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

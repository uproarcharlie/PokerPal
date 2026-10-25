/**
 * Building blocks for the request schemas and DTOs in shared/api/*. PURE: zod only, no drizzle at
 * runtime, so the client can import every shared/api module.
 *
 * Request schemas strip unknown keys (zod's default) rather than reject them: today's client sends
 * form-only fields such as `enableRebuys`, and a stripped field can never be written.
 */
import { z } from "zod";
import { isBuiltInAvatarUrl } from "../domain/avatars";
import { URL_MAX } from "../domain/urls";

/** A value as `res.json` sends it: Dates become ISO strings, recursively. */
export type Json<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

/** Computed server-side for the signed-in viewer, so the client can show staff controls. */
export interface Viewer {
  /** Admin, the club's owner or one of its managers: may run it. */
  canManage: boolean;
  /** Admin or the club's owner: may also delete it (and its seasons and tournaments) and change its staff. */
  canOwn: boolean;
}

export type WithViewer<T> = T & { viewer: Viewer };

/** Row ids: gen_random_uuid() today, but any short URL-safe token is accepted. */
export const idSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/** Required text, trimmed. */
export const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

/** Optional text: trimmed; blank or null stores NULL; absent leaves the stored value alone. */
export const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional();

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * A decimal(10,2) amount from 0 to 99,999,999.99 with at most two decimal places, as a string or a
 * number. Output is the canonical column text, e.g. 5 → "5.00".
 */
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((text) => MONEY.test(text), "Enter an amount of 0 or more, with at most 2 decimal places")
  .transform((text) => Number(text).toFixed(2));

/** An optional amount: blank or null stores NULL. */
export const optionalMoneySchema = z.preprocess(blankToNull, moneySchema.nullable()).optional();

export const RAKE_TYPES = ["none", "percentage", "fixed"] as const;
export type RakeType = (typeof RAKE_TYPES)[number];
export const rakeTypeSchema = z.enum(RAKE_TYPES);

/** A required instant: an ISO string (with or without offset) or a Date. Invalid dates are refused. */
export const dateSchema = z.union([z.string().trim().min(1), z.date()]).pipe(z.coerce.date());

/**
 * An optional instant. Blank and null mean "no date" (stored as NULL), never 1 January 1970, which is
 * what z.coerce.date() makes of null (DATA-22). Absent leaves the stored value alone.
 */
export const nullableDateSchema = z.preprocess(blankToNull, dateSchema.nullable()).optional();

/** An absolute http(s) URL; blank or null stores NULL. javascript:, data: and the like are refused (SEC-08). */
export const httpUrlSchema = z
  .preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(URL_MAX)
      .url("Must be a valid URL")
      .refine((value) => /^https?:\/\//i.test(value), "Only http and https links are allowed")
      .nullable(),
  )
  .optional();

const UPLOADED_HTTPS = /^https:\/\/[^\s/]+\/[^\r\n]*$/i;
const UPLOADED_PATH = /^\/uploads\/[^\s?#]+$/;

/**
 * An image reference as the upload endpoints return it: an https URL or a path under /uploads/.
 * Blank or null clears the image. The server also checks that a changed URL points at our own
 * storage (an unchanged one is accepted as stored: some legacy keys contain spaces).
 */
export const imageUrlSchema = z
  .preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(URL_MAX)
      .refine(
        (value) => UPLOADED_HTTPS.test(value) || UPLOADED_PATH.test(value),
        "Must be an uploaded image",
      )
      .refine((value) => !value.split("/").includes(".."), "Must be an uploaded image")
      .nullable(),
  )
  .optional();

/**
 * A player's photo (round 5, item 8): an uploaded image as imageUrlSchema takes it, or one of the
 * app's built-in avatars exactly as shared/domain/avatars avatarUrl gives it ("/avatars/shark.svg").
 * The server accepts an avatar path without the own-storage check uploads get.
 */
export const playerImageUrlSchema = z
  .preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(URL_MAX)
      .refine(
        (value) =>
          isBuiltInAvatarUrl(value) || ((UPLOADED_HTTPS.test(value) || UPLOADED_PATH.test(value)) && !value.split("/").includes("..")),
        "Must be an uploaded image or one of the avatars",
      )
      .nullable(),
  )
  .optional();

/**
 * An integer from `min` to `max`, as a JSON number: the one rule for every count, position and points
 * field. Nothing is coerced, so null, "", true or [] are refused (400), never read as 0 or 1 (CQ-P2-01).
 */
export const integerSchema = (min: number, max: number) => z.number().int().min(min).max(max);

/** An optional integer that may be cleared: blank or null stores NULL ("no limit"); absent leaves it alone. */
export const nullableIntegerSchema = (min: number, max: number) =>
  z.preprocess(blankToNull, integerSchema(min, max).nullable()).optional();

/** `?limit=` for lists that grow without bound. */
export const limitSchema = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

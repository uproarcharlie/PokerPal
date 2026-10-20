/**
 * What every react-hook-form + zod form shares (phase3-conventions §3.3, P3REV2-CQ-03): one resolver
 * (`formResolver`), so every form words zod's built-in checks the same way and is checked the same way;
 * whole numbers typed into text boxes (`typedNumber`); and server refusals put on the field they are
 * about (`showServerFieldErrors`), where the person can fix them.
 */
import type { FieldValues, Path, Resolver, UseFormSetError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ErrorCode } from "@shared/api/errors";
import { isApiError, type ApiError } from "@/lib/api/http";

/**
 * zod's built-in refusals in plain words: "Must be 0 or more" instead of "Number must be greater than
 * or equal to 0", "Must be 100 characters or fewer" instead of "String must contain at most 100
 * character(s)". A message the schema gives a check itself ("Overlaps another allocation") always
 * wins over this.
 */
export const formErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "Required" };
      // Every number box is a whole-number box (money is typed as text with its own rule).
      if (issue.expected === "integer" || issue.expected === "number") return { message: "Must be a whole number" };
      break;
    case z.ZodIssueCode.invalid_date:
      return { message: "Enter a valid date" };
    case z.ZodIssueCode.too_small:
      // A blank date box: the date rule starts with a non-empty text check.
      if (issue.type === "string" && issue.minimum === 1) return { message: "Required" };
      if (issue.type === "number") return { message: `Must be ${String(issue.minimum)} or more` };
      break;
    case z.ZodIssueCode.too_big:
      if (issue.type === "number") return { message: `Must be ${String(issue.maximum)} or less` };
      if (issue.type === "string") return { message: `Must be ${String(issue.maximum)} characters or fewer` };
      break;
    default:
      break;
  }
  return { message: ctx.defaultError };
};

/**
 * The resolver for every form: checks what the boxes hold with `schema` and the wording above. The
 * submit handler gets the values as typed and sends `schema.parse(values)`, the typed request body,
 * so each form's values are parsed once (`raw`).
 */
export function formResolver<T extends FieldValues>(schema: z.ZodTypeAny): Resolver<T> {
  return zodResolver(schema, { errorMap: formErrorMap }, { raw: true });
}

/**
 * Whole numbers are typed into text boxes (`inputMode="numeric"`: no scroll-wheel changes, no "e"), so
 * a box holds text; the shared request schemas want JSON numbers (nothing is coerced on the server:
 * CQ-P2-01). "" is no value (null, which a nullable field stores as "no limit"); anything else is read
 * as a number, for the shared field's own rule to check.
 */
export function readNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text === "" ? null : Number(text);
}

/** As readNumber, but a blank box leaves the value out (undefined), for a field the server defaults. */
export const readOptionalNumber = (value: unknown): unknown => (typeof value === "string" && value.trim() === "" ? undefined : readNumber(value));

/** The shared field schema, fed the number typed into a text box. */
export const typedNumber = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(readNumber, schema);

interface ServerFieldErrorOptions<T extends FieldValues> {
  /** The form's fields: a list of names, or a test for a nested one ("allocations.1.position"). */
  fields: readonly Path<T>[] | ((name: string) => boolean);
  /** Refusals that are about one field whatever their details say: `{ PHONE_TAKEN: "phone" }`. */
  codes?: Partial<Record<ErrorCode, Path<T>>>;
}

/** The sentence for a field: the server's, or the list of rules a WEAK_PASSWORD answer says were broken. */
function fieldMessage(error: ApiError): string {
  if (error.code === "WEAK_PASSWORD" && Array.isArray(error.details)) {
    const problems = error.details.filter((detail): detail is string => typeof detail === "string");
    if (problems.length > 0) return `${problems.join(". ")}.`;
  }
  return error.error;
}

/**
 * Each place a refusal names a field, with its sentence: `details.field` (PERCENT_OVER_100,
 * AMOUNT_REQUIRED), or a VALIDATION issue's path, tried whole ("allocations.1.position") and then by its
 * first part ("phone").
 */
function namedFields(error: ApiError): { names: string[]; message: string }[] {
  const { details } = error;
  if (typeof details === "object" && details !== null && !Array.isArray(details)) {
    const field = (details as { field?: unknown }).field;
    return typeof field === "string" ? [{ names: [field], message: error.error }] : [];
  }
  if (error.code !== "VALIDATION" || !Array.isArray(details)) return [];
  return details.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null) return [];
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (!Array.isArray(path) || path.length === 0 || typeof message !== "string") return [];
    if (!path.every((part) => typeof part === "string" || typeof part === "number")) return [];
    return [{ names: [path.join("."), String(path[0])], message }];
  });
}

/**
 * Puts a server refusal that is about the form's fields under those fields (the first one gets the
 * focus) and returns true; false when it is about nothing on the form, for the caller's toast or alert.
 */
export function showServerFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: unknown,
  { fields, codes = {} }: ServerFieldErrorOptions<T>,
): boolean {
  if (!isApiError(error)) return false;
  const isField = typeof fields === "function" ? fields : (name: string) => (fields as readonly string[]).includes(name);

  const byCode = error.code ? codes[error.code] : undefined;
  if (byCode) {
    setError(byCode, { type: "server", message: fieldMessage(error) }, { shouldFocus: true });
    return true;
  }

  let shown = false;
  for (const { names, message } of namedFields(error)) {
    const name = names.find(isField);
    if (name === undefined) continue;
    setError(name as Path<T>, { type: "server", message }, { shouldFocus: !shown });
    shown = true;
  }
  return shown;
}

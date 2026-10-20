import { z } from "zod";
import { passwordProblems, passwordSchema } from "@shared/api/auth";

/** The rules the server applies to a new password, in the words the forms show under the field. */
export const PASSWORD_RULES = "Must be at least 8 characters with uppercase, lowercase, and number";

/**
 * A new password, checked against the server's own rules (`passwordProblems`) before it is sent, so a
 * weak one is caught at the field rather than after a round trip.
 */
export const newPasswordSchema = passwordSchema.superRefine((password, ctx) => {
  const problems = passwordProblems(password);
  if (problems.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${problems.join(". ")}.` });
});

import { errorMessage, hasErrorCode, isApiError } from "@/lib/api/http";

export interface FormProblem {
  title: string;
  message: string;
}

/**
 * What to tell someone whose sign-in or sign-up was refused for a reason that is not one field's:
 * the server's own sentence under a heading that says what kind of problem it is, so a throttled
 * attempt reads as "wait", not as a wrong password.
 */
export function authProblem(error: unknown, failedTitle: string): FormProblem {
  if (hasErrorCode(error, "RATE_LIMITED")) return { title: "Too many attempts", message: errorMessage(error) };
  if (isApiError(error) && error.status === 0) return { title: "No connection", message: errorMessage(error) };
  if (hasErrorCode(error, "ACCOUNT_DISABLED")) {
    return { title: "Account disabled", message: "This account has been disabled. A platform administrator can turn it back on." };
  }
  return { title: failedTitle, message: errorMessage(error) };
}

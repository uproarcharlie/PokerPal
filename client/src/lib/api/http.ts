/**
 * The one way the client talks to /api: typed JSON (or FormData) requests that resolve with the
 * parsed body and throw an ApiError for any answer that is not 2xx. Feature `api.ts` modules call
 * these; nothing else calls fetch for /api.
 */
import { isApiErrorBody, isErrorCode, type ApiErrorBody, type ErrorCode } from "@shared/api/errors";

/** What a person reads when the server could not be reached at all. */
export const NETWORK_ERROR_MESSAGE = "Could not reach the server. Check your connection and try again.";

/** What a person reads when the server took too long to answer (REQUEST_TIMEOUT_MS). */
export const TIMEOUT_ERROR_MESSAGE = "The server took too long to answer. Check your connection and try again.";

/**
 * A request with no complete answer after this long is given up, as no answer (status 0). On venue
 * Wi-Fi that is joined but has no way out, a request can otherwise hang for minutes, and TanStack
 * Query asks nothing new for a query while one is in flight: every poll of the pool and standings
 * would wait behind it (P3REV4-PERF-03). Giving up lets the retry and the next poll go.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
/** A change gets longer: the server may still be applying it. */
export const SEND_TIMEOUT_MS = 30_000;

/** What a person reads when nothing more specific is known. */
export const FALLBACK_ERROR_MESSAGE = "Something went wrong. Please try again.";

interface ApiErrorInit {
  status: number;
  error: string;
  code?: ErrorCode;
  details?: unknown;
  /** Defaults to `error`; a VALIDATION error adds its first problem. */
  message?: string;
}

/**
 * A non-2xx answer from the API (or status 0: no answer at all). `error` is the server's sentence for
 * people, `message` the same with the first validation problem added (what a toast shows), `code` what
 * code branches on (e.g. "PLAN_CHANGED"), `details` the code-specific extra (zod issues, `{ preview }`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: ErrorCode;
  readonly error: string;
  readonly details?: unknown;

  constructor({ status, error, code, details, message }: ApiErrorInit) {
    super(message ?? error);
    this.name = "ApiError";
    this.status = status;
    this.error = error;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Whether `error` is an ApiError carrying one of `codes`. */
export function hasErrorCode(error: unknown, ...codes: ErrorCode[]): error is ApiError {
  return isApiError(error) && error.code !== undefined && codes.includes(error.code);
}

/**
 * A refusal that asking again will not change: what was asked for is gone (404, 410) or no longer the
 * viewer's to see (403). A page following it stops polling and says so, rather than "reconnecting"
 * every few seconds (P3REV4-PERF-D).
 */
export function isLastingRefusal(error: unknown): error is ApiError {
  return isApiError(error) && (error.status === 403 || error.status === 404 || error.status === 410);
}

/** Whether `error` is a request this app gave up on after REQUEST_TIMEOUT_MS / SEND_TIMEOUT_MS. */
export function isTimeout(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 0 && error.error === TIMEOUT_ERROR_MESSAGE;
}

/** The sentence to show for any thrown value: the server's for an ApiError, else `fallback`. */
export function errorMessage(error: unknown, fallback = FALLBACK_ERROR_MESSAGE): string {
  return isApiError(error) && error.message ? error.message : fallback;
}

/** The first problem a VALIDATION body lists (zod issues or plain sentences), added to its sentence. */
function describeError(body: ApiErrorBody): string {
  if (!Array.isArray(body.details) || body.details.length === 0) return body.error;
  const first: unknown = body.details[0];
  if (typeof first === "string") return `${body.error}: ${body.details.filter((d) => typeof d === "string").join("; ")}`;
  if (body.code !== "VALIDATION" || typeof first !== "object" || first === null) return body.error;
  const issue = first as { path?: unknown; message?: unknown };
  if (typeof issue.message !== "string") return body.error;
  const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
  return `${body.error} (${path ? `${path}: ` : ""}${issue.message})`;
}

/** The ApiError for a response body (text) and status, as the central error handler shaped it. */
export function apiErrorFromBody(status: number, text: string, statusText = ""): ApiError {
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (isApiErrorBody(body)) {
    return new ApiError({
      status,
      error: body.error,
      message: describeError(body),
      code: isErrorCode(body.code) ? body.code : undefined,
      details: body.details,
    });
  }
  // Not our JSON (a proxy page, an empty body): never show markup to people.
  const plain = text && !text.trimStart().startsWith("<") ? text.slice(0, 200) : "";
  return new ApiError({ status, error: plain || statusText || `Request failed (${status})` });
}

const sessionExpiredListeners = new Set<() => void>();

/** Called whenever the API says the session is gone; returns the unsubscribe function. */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

/** A 401 that means "not signed in (any longer)", as opposed to a wrong password. */
function isSessionExpiry(error: ApiError): boolean {
  return error.status === 401 && (error.code === undefined || error.code === "UNAUTHENTICATED");
}

/** Tells the session listeners about a 401 that ended the session; every request path calls this. */
export function reportApiError(error: ApiError): void {
  if (isSessionExpiry(error)) sessionExpiredListeners.forEach((listener) => listener());
}

export type SendMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * An abort signal for one request: the caller's (TanStack Query cancelling, an upload replaced) or
 * the timeout's, whichever comes first. Built by hand: AbortSignal.any and AbortSignal.timeout are
 * missing from the older Safari some phones at a venue still run.
 */
function timeoutSignal(caller: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const forward = () => controller.abort(caller?.reason);
  if (caller?.aborted) forward();
  else caller?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", forward);
    },
  };
}

/** A request cancelled on purpose (TanStack Query, a replaced upload): nothing to show. */
export function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

/**
 * The parsed answer to a request, or the ApiError for a non-2xx answer, no answer, or none in time.
 * The timeout covers reading the body too: a stalled connection can stop halfway through it.
 */
async function request<T>(method: "GET" | SendMethod, url: string, body: unknown, { signal }: RequestOptions): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const limit = timeoutSignal(signal, method === "GET" ? REQUEST_TIMEOUT_MS : SEND_TIMEOUT_MS);
  try {
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method,
        credentials: "include",
        headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
        signal: limit.signal,
      });
      text = res.status === 204 ? "" : await res.text();
    } catch (cause) {
      if (limit.timedOut()) throw new ApiError({ status: 0, error: TIMEOUT_ERROR_MESSAGE });
      // A cancelled query or upload is not an error to show: let TanStack Query see the abort.
      if (isAbortError(cause)) throw cause;
      throw new ApiError({ status: 0, error: NETWORK_ERROR_MESSAGE });
    }
    if (!res.ok) {
      const error = apiErrorFromBody(res.status, text, res.statusText);
      reportApiError(error);
      throw error;
    }
    return (text ? JSON.parse(text) : undefined) as T;
  } finally {
    limit.done();
  }
}

/** GET `url`; the parsed JSON body. */
export function apiGet<T>(url: string, options: RequestOptions = {}): Promise<T> {
  return request<T>("GET", url, undefined, options);
}

/** POST/PUT/PATCH/DELETE `url` with a JSON body (or FormData as it is); the parsed body, undefined for 204. */
export function apiSend<T = void>(method: SendMethod, url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>(method, url, body, options);
}

type QueryValue = string | number | boolean | null | undefined;

/** `path` with the given query parameters; null, undefined and "" are left out. */
export function withQuery(path: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

/** A path segment from an id or slug, so a stray "/" or "?" can never change which endpoint is called. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}

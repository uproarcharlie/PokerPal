import { QueryClient, type QueryFunction } from "@tanstack/react-query";
import { isApiErrorBody, isErrorCode, type ApiErrorBody, type ErrorCode } from "@shared/api/errors";

/**
 * A non-2xx answer from the API. `message` is the server's sentence for people (the body's `error`),
 * so a toast can show it as it is; `code` is what code branches on (e.g. "PLAN_CHANGED").
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: ErrorCode, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

/** The first problem a VALIDATION body lists (zod issues or plain sentences), added to its message. */
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

async function errorFromResponse(res: Response): Promise<ApiRequestError> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (isApiErrorBody(body)) {
    return new ApiRequestError(res.status, describeError(body), isErrorCode(body.code) ? body.code : undefined, body.details);
  }
  // Not our JSON (a proxy page, an empty body): never show markup to people.
  const plain = text && !text.trimStart().startsWith("<") ? text.slice(0, 200) : "";
  return new ApiRequestError(res.status, plain || res.statusText || `Request failed (${res.status})`);
}

const sessionExpiredListeners = new Set<() => void>();

/** Called whenever the API says the session is gone; returns the unsubscribe function. */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

/** A 401 that means "not signed in" (any longer), as opposed to a wrong password. */
function isSessionExpiry(error: ApiRequestError): boolean {
  return error.status === 401 && (error.code === undefined || error.code === "UNAUTHENTICATED");
}

/** Throws an ApiRequestError for a non-2xx response, and tells the session listeners about a 401. */
export async function throwIfResNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const error = await errorFromResponse(res);
  if (isSessionExpiry(error)) sessionExpiredListeners.forEach((listener) => listener());
  throw error;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

/** apiRequest, then the parsed JSON body. */
export async function apiJson<T>(method: string, url: string, data?: unknown): Promise<T> {
  const res = await apiRequest(method, url, data);
  return (await res.json()) as T;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/** The app's query defaults; tests build their own client with the same ones. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        refetchInterval: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryClient = createQueryClient();

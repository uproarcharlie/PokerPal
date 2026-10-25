/**
 * What a screen sent, for the web tests: one reader and one MSW recorder, which every feature's presets
 * (clock-dto, seating-dto, f1-tournaments) build on rather than each reading and parsing bodies itself.
 */
import { http } from "msw";
import { server } from "../msw/server";

/** One request a screen sent: its method, path and JSON body (undefined when it had none). */
export interface SentRequest {
  method: string;
  path: string;
  body: unknown;
}

/** The request's method, path and JSON body. It reads the body, so call it once per request. */
export async function readSentRequest(request: Request): Promise<SentRequest> {
  const text = await request.text();
  return { method: request.method, path: new URL(request.url).pathname, body: text ? (JSON.parse(text) as unknown) : undefined };
}

export type RecordedMethod = "get" | "post" | "put" | "patch" | "delete";
export type RecordedRoute = readonly [RecordedMethod, string];

/**
 * Answers every request to `routes` (method and MSW path pairs) with `answer(sent)`, and records each
 * one, in order, in the array it returns: the SentRequest, or what `pick` makes of it.
 */
export function recordRequests(routes: readonly RecordedRoute[], answer: (sent: SentRequest) => Response | Promise<Response>): SentRequest[];
export function recordRequests<T>(
  routes: readonly RecordedRoute[],
  answer: (sent: SentRequest) => Response | Promise<Response>,
  pick: (sent: SentRequest) => T,
): T[];
export function recordRequests<T>(
  routes: readonly RecordedRoute[],
  answer: (sent: SentRequest) => Response | Promise<Response>,
  pick?: (sent: SentRequest) => T,
): Array<T | SentRequest> {
  const recorded: Array<T | SentRequest> = [];
  server.use(
    ...routes.map(([method, path]) =>
      http[method](path, async ({ request }) => {
        const sent = await readSentRequest(request);
        recorded.push(pick ? pick(sent) : sent);
        return answer(sent);
      }),
    ),
  );
  return recorded;
}

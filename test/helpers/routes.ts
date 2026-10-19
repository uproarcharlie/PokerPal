/**
 * The API's routes as the running app registered them, read from Express's router stack, with the
 * guards (server/http/authz.ts tags) each one mounts. The route-inventory tests compare this with
 * their tables, so a route added without a guard, or without a test, fails them. Import it by path
 * (the helpers' index is frozen in Phase 2).
 *
 * Guards are read from the route's own middleware list, which is where every route module mounts
 * them (`router.post(path, requireAuth, ...)`); a guard mounted with `router.use` would not be seen.
 */
import type { Express } from "express";
import { guardOf } from "../../server/http/authz";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AppRoute {
  method: HttpMethod;
  /** As registered, e.g. "/api/tournaments/:id/registrations". */
  path: string;
  /** "POST /api/tournaments/:id/registrations" */
  key: string;
  /**
   * What each guard middleware enforces, in mount order: "auth", "admin", "player-manager",
   * "club-manager:<Resource>", "club-owner:<Resource>" or "public:<reason>" (allowPublic).
   */
  guards: string[];
}

/** The slice of Express 4's internal Layer this reads. */
interface Layer {
  route?: { path: unknown; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
  handle?: { stack?: Layer[] };
}

const METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export const isWrite = (route: Pick<AppRoute, "method">): boolean => route.method !== "GET";

/** Every route of `app` (nested routers included), in registration order. */
export function appRoutes(app: Express): AppRoute[] {
  const root = (app as unknown as { _router?: { stack: Layer[] } })._router?.stack;
  if (!root) throw new Error("The app has no router stack to read");

  const routes: AppRoute[] = [];
  const walk = (layers: readonly Layer[]) => {
    for (const layer of layers) {
      if (layer.route) {
        const { path, methods, stack } = layer.route;
        if (typeof path !== "string") throw new Error(`A route with a non-string path cannot be inventoried: ${String(path)}`);
        const guards = stack.flatMap(({ handle }) => {
          const guard = guardOf(handle);
          return guard ? [guard.detail ? `${guard.kind}:${guard.detail}` : guard.kind] : [];
        });
        for (const name of Object.keys(methods)) {
          const method = name.toUpperCase();
          if (!METHODS.has(method)) throw new Error(`Unexpected method ${method} on ${path}`);
          routes.push({ method: method as HttpMethod, path, key: `${method} ${path}`, guards });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(root);
  return routes;
}

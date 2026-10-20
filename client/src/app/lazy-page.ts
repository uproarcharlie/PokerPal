/**
 * The router's on-demand pages (and the staff layout): React.lazy, plus what a phone on venue Wi-Fi
 * or a tab left open across a deploy needs (P3REV4-PERF-01, PERF-07).
 *
 * - A script that fails to arrive is asked for once more before the page gives up (a dropped request).
 * - When it still fails and a newer version of the app is live (its scripts were replaced), the page
 *   reloads once, onto the new version, instead of showing an error.
 * - `preload()` starts a page's download before it is drawn: a staff deep link fetches the page's code
 *   while the staff layout and the sign-in check are still loading, not after them.
 * - A page that failed to load is asked for again once its error is cleared (the person moves to
 *   another page and back, or presses Try again: `retryFailedPages`), instead of failing at once for
 *   the rest of the session (P3REV4-PERF-C). The rich-text editor loads the same way (P3REV4-PERF-B).
 * - A script, or the check for a newer version, that stalls instead of failing is given up on after
 *   a while, so a stalled connection ends on the error page's Reload, not a spinner for minutes
 *   (P3REV-PERF-LAZY-NO-TIMEOUT).
 * - A page's stylesheet that fails to arrive is asked for again too, before the page is shown: Vite
 *   asks for each stylesheet only once, so the script's retry would otherwise draw the page without
 *   it, e.g. the photo crop step without its frame (P3REV-PERF-CSS-PRELOAD-MASKED).
 */
import { createElement, lazy, type ComponentProps, type ComponentType } from "react";
import { pageNavigation } from "@/lib/page-navigation";

/** How long to wait before asking for a script again. */
export const SCRIPT_RETRY_MS = 1000;

/** How long a page's script may take to arrive before it counts as failed (an API read gets 15 s). */
export const SCRIPT_TIMEOUT_MS = 20_000;

/** How long the check for a newer version may take. */
export const VERSION_CHECK_TIMEOUT_MS = 10_000;

/** A script that stalled: worded as the browsers word a failed one, so the error page offers Reload. */
export class ScriptTimeoutError extends Error {
  constructor() {
    super("Loading chunk timed out: the page's script took too long to arrive");
    this.name = "ScriptTimeoutError";
  }
}

/** `load()`, or a ScriptTimeoutError once SCRIPT_TIMEOUT_MS have gone by without it. */
function withinLimit<T>(load: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScriptTimeoutError()), SCRIPT_TIMEOUT_MS);
  });
  return Promise.race([load(), limit]).finally(() => clearTimeout(timer));
}

const RELOADED_FOR_KEY = "lovepoker:reloaded-for-version";

/** The script the page was started from ("/assets/index-<hash>.js" in a build; none in development). */
const entryScript = (doc: Document) =>
  Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map((script) => script.getAttribute("src") ?? "")
    .find((src) => /\/assets\/index-[^/]+\.js$/.test(src)) ?? null;

/** The entry script of the version now live, when it is not the one this page runs. */
async function newerVersion(): Promise<string | null> {
  const running = entryScript(document);
  if (running === null) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch("/", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    if (!response.ok) return null;
    const live = entryScript(new DOMParser().parseFromString(await response.text(), "text/html"));
    return live !== null && live !== running ? live : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Reloads onto `version`, once: a second failure on the same version is left to the error page. */
function reloadOnceFor(version: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FOR_KEY) === version) return false;
    sessionStorage.setItem(RELOADED_FOR_KEY, version);
  } catch {
    return false;
  }
  pageNavigation.reload();
  return true;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stylesheet that still would not arrive: worded as a failed script is, so the error page offers Reload. */
export class StylesheetLoadError extends Error {
  constructor(href: string) {
    super(`Loading chunk stylesheet failed: ${href}`);
    this.name = "StylesheetLoadError";
  }
}

/** How Vite's preload helper words a page's stylesheet that did not arrive. */
const STYLESHEET_FAILURE = /^Unable to preload CSS for (\S+)$/;

/**
 * Stylesheets that did not arrive. Vite's helper asks for each one once, ever: asked for again (the
 * retry, Try again) it skips the stylesheet and loads the script, so the page would be drawn without
 * it and nothing would say so. Any page drawn while one is missing asks for it first, as any of them
 * may need it (one stylesheet is often shared by several pages).
 */
const missingStylesheets = new Set<string>();

function noteMissingStylesheet(error: unknown): void {
  const href = error instanceof Error ? STYLESHEET_FAILURE.exec(error.message)?.[1] : undefined;
  if (href !== undefined) missingStylesheets.add(href);
}

/** Asks for a stylesheet again with a new <link>: the browser never retries a link that failed, so that one goes. */
function loadStylesheet(href: string): Promise<void> {
  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
    if (link.getAttribute("href") === href) link.remove();
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", () => {
      missingStylesheets.delete(href);
      resolve();
    });
    link.addEventListener("error", () => reject(new StylesheetLoadError(href)));
    document.head.append(link);
  });
}

/** The page's module, once its script and every stylesheet still missing have arrived. */
async function loadPage<T>(load: () => Promise<T>): Promise<T> {
  try {
    const page = await load();
    await Promise.all(Array.from(missingStylesheets, loadStylesheet));
    return page;
  } catch (error) {
    noteMissingStylesheet(error);
    throw error;
  }
}

async function loadWithRecovery<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await withinLimit(() => loadPage(load));
  } catch (first) {
    try {
      // A stalled script is not asked for again: the browser would join the same stalled request.
      if (first instanceof ScriptTimeoutError) throw first;
      await pause(SCRIPT_RETRY_MS);
      return await withinLimit(() => loadPage(load));
    } catch (error) {
      const version = await newerVersion();
      // While the page reloads onto the new version, the error page is not shown.
      if (version !== null && reloadOnceFor(version)) return new Promise<T>(() => {});
      throw error;
    }
  }
}

export interface Preloadable {
  /** Starts downloading the page's code now (harmless when it is already loaded or loading). */
  preload: () => void;
}

/** The pages whose last load failed: each starts a fresh load the next time it is drawn after `retryFailedPages`. */
const failedPages = new Set<() => void>();

/**
 * Lets every page that failed to load be asked for again. React.lazy keeps a failed load for good, so
 * an error boundary calls this when it clears its error (the person moved to another page, or pressed
 * Try again), and the page is fetched afresh rather than failing at once (P3REV4-PERF-C).
 */
export function retryFailedPages(): void {
  failedPages.forEach((renew) => renew());
  failedPages.clear();
}

/** A lazily loaded page or layout that recovers from a dropped or outdated script, and can be preloaded. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React.lazy's own bound: a component with any props
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let loading: Promise<{ default: T }> | undefined;
  const loadOnce = (): Promise<{ default: T }> =>
    (loading ??= loadWithRecovery(load).catch((error: unknown) => {
      loading = undefined;
      failedPages.add(() => {
        current = lazy(loadOnce);
      });
      throw error;
    }));
  let current = lazy(loadOnce);
  const preloadable: Preloadable = { preload: () => void loadOnce().catch(() => undefined) };
  function LazyPage(props: ComponentProps<T>) {
    return createElement(current, props);
  }
  return Object.assign(LazyPage, preloadable);
}

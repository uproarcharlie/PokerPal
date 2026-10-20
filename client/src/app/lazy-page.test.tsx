import { Suspense, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { pageNavigation } from "@/lib/page-navigation";
import { isChunkLoadError, RouteErrorBoundary } from "./error-boundary";
import { lazyPage, SCRIPT_RETRY_MS, SCRIPT_TIMEOUT_MS, ScriptTimeoutError, StylesheetLoadError, VERSION_CHECK_TIMEOUT_MS } from "./lazy-page";

const Page = () => <h1>The page</h1>;
const chunkError = () => new TypeError("Failed to fetch dynamically imported module: /assets/page-abc.js");

function Shell({ children }: { children: ReactNode }) {
  return (
    <RouteErrorBoundary homeHref="/">
      <Suspense fallback={<p>Loading</p>}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

/** The page as a build runs it: started from a hashed entry script. */
function runningVersion(entry: string) {
  const script = document.createElement("script");
  script.type = "module";
  script.setAttribute("src", entry);
  document.head.append(script);
  return () => script.remove();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("lazyPage (P3REV4-PERF-01)", () => {
  it("asks for a page's script once more when the first request drops, and shows the page", async () => {
    const load = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValue({ default: Page });
    const Lazy = lazyPage(load);
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );

    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));

    expect(await screen.findByRole("heading", { name: "The page" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shows the could-not-load page, with Reload, when the script will not come", async () => {
    const Lazy = lazyPage(vi.fn().mockRejectedValue(chunkError()));
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );

    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));

    expect(await screen.findByRole("alert")).toHaveTextContent("This page could not be loaded");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("gives up on a script that stalls, and on a version check that stalls, ending on Reload, not a spinner (P3REV-PERF-LAZY-NO-TIMEOUT)", async () => {
    const forget = runningVersion("/assets/index-old111.js");
    server.use(http.get("/", () => new Promise<Response>(() => {})));
    const load = vi.fn(() => new Promise<{ default: typeof Page }>(() => {}));
    const Lazy = lazyPage(load);
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );
    expect(screen.getByText("Loading")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_TIMEOUT_MS + VERSION_CHECK_TIMEOUT_MS + 10));

    expect(await screen.findByRole("alert")).toHaveTextContent("This page could not be loaded");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    // A stalled script is not asked for again: the browser would only join the same stalled request.
    expect(load).toHaveBeenCalledTimes(1);
    expect(isChunkLoadError(new ScriptTimeoutError())).toBe(true);
    forget();
  });

  it("reloads once onto a newer version when the old one's scripts are gone after a deploy", async () => {
    const forget = runningVersion("/assets/index-old111.js");
    server.use(http.get("/", () => HttpResponse.text('<html><head><script type="module" src="/assets/index-new222.js"></script></head></html>')));
    const reload = vi.spyOn(pageNavigation, "reload").mockImplementation(() => {});
    const Lazy = lazyPage(vi.fn().mockRejectedValue(chunkError()));
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );

    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("lovepoker:reloaded-for-version")).toBe("/assets/index-new222.js");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    forget();
  });

  it("does not reload again for the same version: a second failure shows the error page", async () => {
    const forget = runningVersion("/assets/index-old111.js");
    sessionStorage.setItem("lovepoker:reloaded-for-version", "/assets/index-new222.js");
    server.use(http.get("/", () => HttpResponse.text('<html><head><script type="module" src="/assets/index-new222.js"></script></head></html>')));
    const reload = vi.spyOn(pageNavigation, "reload").mockImplementation(() => {});
    const Lazy = lazyPage(vi.fn().mockRejectedValue(chunkError()));
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );

    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));

    expect(await screen.findByRole("alert")).toHaveTextContent("This page could not be loaded");
    expect(reload).not.toHaveBeenCalled();
    forget();
  });

  it("starts a page's download before it is drawn, and downloads it once (P3REV4-PERF-07)", async () => {
    const load = vi.fn().mockResolvedValue({ default: Page });
    const Lazy = lazyPage(load);

    Lazy.preload();
    expect(load).toHaveBeenCalledTimes(1);
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );

    expect(await screen.findByRole("heading", { name: "The page" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads a page that failed for good once the connection is back, when it is drawn again (P3REV4-PERF-C)", async () => {
    const load = vi.fn().mockRejectedValueOnce(chunkError()).mockRejectedValueOnce(chunkError()).mockResolvedValue({ default: Page });
    const Lazy = lazyPage(load);
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );
    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));
    expect(await screen.findByRole("heading", { name: "This page could not be loaded" })).toBeInTheDocument();

    // The connection is back; the person asks for the page again.
    await act(async () => screen.getByRole("button", { name: "Try again" }).click());

    expect(await screen.findByRole("heading", { name: "The page" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("loads it afresh after the person moves to another page and comes back (P3REV4-PERF-C)", async () => {
    const load = vi.fn().mockRejectedValueOnce(chunkError()).mockRejectedValueOnce(chunkError()).mockResolvedValue({ default: Page });
    const Lazy = lazyPage(load);
    const at = (location: string, page: ReactNode) => (
      <RouteErrorBoundary homeHref="/" resetKey={location}>
        <Suspense fallback={<p>Loading</p>}>{page}</Suspense>
      </RouteErrorBoundary>
    );
    const { rerender } = render(at("/clubs", <Lazy />));
    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));
    expect(await screen.findByRole("heading", { name: "This page could not be loaded" })).toBeInTheDocument();

    rerender(at("/players", <p>Players</p>));
    rerender(at("/clubs", <Lazy />));

    expect(await screen.findByRole("heading", { name: "The page" })).toBeInTheDocument();
  });
});

describe("lazyPage: a page's stylesheet that did not arrive (P3REV-PERF-CSS-PRELOAD-MASKED)", () => {
  const CROP_CSS = "/assets/image-field-abc.css";
  /** Vite's preload helper: it rejects for a stylesheet that failed and leaves the failed <link> behind. */
  const stylesheetError = () => new Error(`Unable to preload CSS for ${CROP_CSS}`);
  const linksTo = (href: string) =>
    Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter((link) => link.getAttribute("href") === href);

  function failedLink() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CROP_CSS;
    document.head.append(link);
    return link;
  }

  /** The stylesheet lazyPage asked for again, once it has. */
  async function askedAgain(stale: HTMLLinkElement) {
    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));
    const [link] = linksTo(CROP_CSS);
    expect(link).toBeDefined();
    expect(link).not.toBe(stale);
    return link;
  }

  afterEach(() => {
    linksTo(CROP_CSS).forEach((link) => link.remove());
  });

  it("asks for the stylesheet again and shows the page only once it is in, not without it", async () => {
    const stale = failedLink();
    // The retry's script loads: Vite skips a stylesheet it has asked for before.
    const load = vi.fn().mockRejectedValueOnce(stylesheetError()).mockResolvedValue({ default: Page });
    const Lazy = lazyPage(load);
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );

    const link = await askedAgain(stale);
    expect(stale.isConnected).toBe(false);
    expect(screen.queryByRole("heading", { name: "The page" })).not.toBeInTheDocument();

    await act(async () => link.dispatchEvent(new Event("load")));
    expect(await screen.findByRole("heading", { name: "The page" })).toBeInTheDocument();
  });

  it("ends on Reload when it still will not come, and asks for it again on Try again", async () => {
    const stale = failedLink();
    const load = vi.fn().mockRejectedValueOnce(stylesheetError()).mockResolvedValue({ default: Page });
    const Lazy = lazyPage(load);
    render(
      <Shell>
        <Lazy />
      </Shell>,
    );

    const link = await askedAgain(stale);
    await act(async () => link.dispatchEvent(new Event("error")));
    expect(await screen.findByRole("heading", { name: "This page could not be loaded" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(isChunkLoadError(new StylesheetLoadError(CROP_CSS))).toBe(true);

    // Try again draws the page afresh: its script is in, the stylesheet is asked for once more.
    await act(async () => screen.getByRole("button", { name: "Try again" }).click());
    const again = linksTo(CROP_CSS);
    expect(again).toHaveLength(1);
    expect(again[0]).not.toBe(link);
    await act(async () => again[0].dispatchEvent(new Event("load")));
    expect(await screen.findByRole("heading", { name: "The page" })).toBeInTheDocument();
  });
});

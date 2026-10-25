/**
 * Setup for the `web` project (jsdom): jest-dom matchers, RTL cleanup, MSW, and
 * stand-ins for the browser APIs jsdom lacks that the client uses (media
 * queries, ResizeObserver, pointer capture and scrollIntoView, <video>
 * playback, canvas capture, object URLs and the camera). createImageBitmap stays missing, as in an old browser; the
 * image tests that need it stub it.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { fakeMediaStream } from "../helpers/media";
import { server } from "../msw/server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
// A plain global, not vi.stubGlobal: a test file's vi.unstubAllGlobals() (after stubbing XMLHttpRequest)
// would otherwise take it away for the rest of the file, and Radix's switches and sliders measure with it.
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserverStub });

// Radix Select captures the pointer and scrolls the chosen option into view when it opens.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no media pipeline: play() would log "Not implemented" and never settle.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: () => {} });

// Canvas capture ("Take Photo", the mirrored front camera) and redrawing: a drawable 2D context and a small JPEG blob.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: function getContext(this: HTMLCanvasElement, contextId: string) {
    return contextId === "2d"
      ? ({ canvas: this, drawImage: () => {}, fillRect: () => {}, translate: () => {}, scale: () => {} } as unknown as CanvasRenderingContext2D)
      : null;
  },
});
Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
  configurable: true,
  value: (callback: BlobCallback, type = "image/png") => {
    callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type }));
  },
});

// jsdom has no object URLs (image previews, the crop step): hand out distinct fake ones.
let objectUrls = 0;
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  writable: true,
  value: vi.fn(() => `blob:test/${++objectUrls}`),
});
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });

// Each call resolves a new fake stream; read them back from the mock's results.
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: { getUserMedia: vi.fn(async () => fakeMediaStream()) },
});

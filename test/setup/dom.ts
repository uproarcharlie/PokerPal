/**
 * Setup for the `web` project (jsdom): jest-dom matchers, RTL cleanup, MSW, and
 * stand-ins for the browser APIs jsdom lacks that the client uses (media
 * queries, ResizeObserver, <video> playback, canvas capture and the camera).
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
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// jsdom has no media pipeline: play() would log "Not implemented" and never settle.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: () => {} });

// Canvas capture (ImageUpload's "Take Photo"): a drawable 2D context and a small JPEG blob.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: function getContext(this: HTMLCanvasElement, contextId: string) {
    return contextId === "2d" ? ({ canvas: this, drawImage: () => {} } as unknown as CanvasRenderingContext2D) : null;
  },
});
Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
  configurable: true,
  value: (callback: BlobCallback, type = "image/png") => {
    callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type }));
  },
});

// Each call resolves a new fake stream; read them back from the mock's results.
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: { getUserMedia: vi.fn(async () => fakeMediaStream()) },
});

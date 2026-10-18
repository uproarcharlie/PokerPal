import { vi } from "vitest";

/** A camera stream whose tracks record `stop()`, so tests can assert the camera is released. */
export function fakeMediaStream(): MediaStream {
  const track = { kind: "video", enabled: true, readyState: "live", stop: vi.fn() };
  return {
    active: true,
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeXhr, type FakeXhr } from "@test/helpers/fake-xhr";
import { isAbortError, NETWORK_ERROR_MESSAGE, onSessionExpired, SEND_TIMEOUT_MS, TIMEOUT_ERROR_MESSAGE } from "@/lib/api/http";
import { uploadImage } from "./upload-image";

const stored = { kind: "player_avatar", url: "/uploads/player_avatar/x/512.webp", variants: {}, width: 512, height: 512, dominantColor: null };
const jpeg = () => new Blob([new Uint8Array(8)], { type: "image/jpeg" });

let sent: FakeXhr[];
beforeEach(() => {
  sent = installFakeXhr();
});
afterEach(() => vi.unstubAllGlobals());

describe("uploadImage", () => {
  it("posts the picture and the crop with the session cookie, reports progress, and resolves with what was stored", async () => {
    const progress = vi.fn();
    const upload = uploadImage("player_avatar", jpeg(), { crop: { x: 0.1, y: 0, width: 0.8, height: 1 }, onProgress: progress });
    const [request] = sent;

    expect(request).toMatchObject({ method: "POST", url: "/api/images/player_avatar", withCredentials: true });
    expect((request.field("image") as File).name).toBe("image.jpg");
    expect((request.field("image") as File).type).toBe("image/jpeg");
    expect(JSON.parse(String(request.field("crop")))).toEqual({ x: 0.1, y: 0, width: 0.8, height: 1 });

    request.progress(50, 100);
    request.respond(201, stored);

    await expect(upload).resolves.toEqual(stored);
    expect(progress).toHaveBeenCalledWith(0.5);
  });

  it("sends no crop when none is given (the server keeps the centre)", () => {
    void uploadImage("club_logo", new Blob(["x"], { type: "image/png" })).catch(() => {});

    expect(sent[0].field("crop")).toBeNull();
    expect((sent[0].field("image") as File).name).toBe("image.png");
  });

  it("rejects with the server's sentence and code", async () => {
    const upload = uploadImage("club_logo", new Blob(["x"], { type: "image/png" }));
    sent[0].respond(413, { error: "That file is too large: images can be at most 5 MB.", code: "FILE_TOO_LARGE" });

    await expect(upload).rejects.toMatchObject({ status: 413, code: "FILE_TOO_LARGE", message: "That file is too large: images can be at most 5 MB." });
  });

  it("reports an ended session like every other request", async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    const upload = uploadImage("club_logo", new Blob(["x"], { type: "image/png" }));
    sent[0].respond(401, { error: "Please sign in", code: "UNAUTHENTICATED" });

    await expect(upload).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("says so when the server cannot be reached", async () => {
    const upload = uploadImage("player_avatar", jpeg());
    sent[0].failToConnect();

    await expect(upload).rejects.toMatchObject({ status: 0, message: NETWORK_ERROR_MESSAGE });
  });

  it("aborts the request when cancelled", async () => {
    const controller = new AbortController();
    const upload = uploadImage("player_avatar", jpeg(), { signal: controller.signal });

    controller.abort();

    const error = await upload.catch((reason: unknown) => reason);
    expect(isAbortError(error)).toBe(true);
    expect(sent[0].aborted).toBe(true);
  });

  it("gives up, as no answer, once the upload has made no progress for SEND_TIMEOUT_MS (P3REV5-CQ-15)", async () => {
    vi.useFakeTimers();
    try {
      const upload = uploadImage("player_avatar", jpeg());
      const outcome = upload.catch((reason: unknown) => reason);

      // Still moving: each step restarts the wait, however long the whole upload takes.
      vi.advanceTimersByTime(SEND_TIMEOUT_MS - 1);
      sent[0].progress(10, 100);
      vi.advanceTimersByTime(SEND_TIMEOUT_MS - 1);
      expect(sent[0].aborted).toBe(false);

      vi.advanceTimersByTime(1);
      await expect(outcome).resolves.toMatchObject({ status: 0, message: TIMEOUT_ERROR_MESSAGE });
      // A timeout is shown, unlike a cancel.
      expect(isAbortError(await outcome)).toBe(false);
      expect(sent[0].aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting once the server has answered", async () => {
    vi.useFakeTimers();
    try {
      const upload = uploadImage("player_avatar", jpeg());
      sent[0].respond(201, stored);
      await expect(upload).resolves.toEqual(stored);

      vi.advanceTimersByTime(SEND_TIMEOUT_MS * 2);
      expect(sent[0].aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

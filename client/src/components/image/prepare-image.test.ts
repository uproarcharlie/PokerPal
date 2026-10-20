import { afterEach, describe, expect, it, vi } from "vitest";
import { HEIC_MESSAGE, MAX_IMAGE_UPLOAD_BYTES, UNSUPPORTED_TYPE_MESSAGE } from "@shared/domain/images";
import { cropForUpload, ImagePrepareError, MAX_UPLOAD_SIDE, prepareImage, TOO_LARGE_MESSAGE, UNREADABLE_IMAGE_MESSAGE } from "./prepare-image";

const photo = (type: string, bytes = 1024, name = "photo") => new File([new Uint8Array(bytes)], name, { type });

/**
 * A browser that can decode pictures: each file decodes to a bitmap of this size (or fails). An old
 * one (`orientationOption: false`) refuses `imageOrientation: "from-image"` with a TypeError, as
 * Chrome before 112, Firefox before 111 and Safari before 16 do.
 */
function decodesTo(width: number, height: number, fail = false, { orientationOption = true } = {}) {
  const close = vi.fn();
  const decoder = vi.fn(async (_image: Blob, options?: ImageBitmapOptions) => {
    if (fail) throw new DOMException("cannot decode", "InvalidStateError");
    if (options?.imageOrientation === "from-image" && !orientationOption) throw new TypeError("The provided value 'from-image' is not a valid enum value");
    return { width, height, close } as unknown as ImageBitmap;
  });
  vi.stubGlobal("createImageBitmap", decoder);
  return { close, decoder };
}

/** What was done on the canvas's 2D context. */
function recordContext() {
  const calls: Array<{ call: string; args: unknown[]; smoothing?: string; fill?: string }> = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(this: HTMLCanvasElement) {
    const context = {
      canvas: this,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillStyle: "#000000",
      fillRect: (...args: unknown[]) => calls.push({ call: "fillRect", args, fill: context.fillStyle }),
      drawImage: (...args: unknown[]) => calls.push({ call: "drawImage", args, smoothing: context.imageSmoothingEnabled ? context.imageSmoothingQuality : "off" }),
    };
    return context as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return calls;
}

/** What the canvas drew at and encoded to. */
function recordCanvas(blobBytes = 2048) {
  const drawn: Array<{ width: number; height: number; type: string }> = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function toBlob(this: HTMLCanvasElement, callback: BlobCallback, type = "image/png") {
    drawn.push({ width: this.width, height: this.height, type });
    callback(new Blob([new Uint8Array(blobBytes)], { type }));
  });
  return drawn;
}

async function refusal(call: Promise<unknown>): Promise<string> {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ImagePrepareError);
  return (error as Error).message;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prepareImage", () => {
  it("sends a photo the server can take as it is, untouched", async () => {
    decodesTo(1600, 1200);
    const file = photo("image/jpeg");

    await expect(prepareImage(file, "player_avatar")).resolves.toBe(file);
  });

  it("shrinks a big phone photo to at most 2048 px, as JPEG", async () => {
    const { close } = decodesTo(4032, 3024);
    const drawn = recordCanvas();

    const prepared = await prepareImage(photo("image/jpeg", MAX_IMAGE_UPLOAD_BYTES + 1), "player_avatar");

    expect(prepared.type).toBe("image/jpeg");
    expect(drawn).toEqual([{ width: MAX_UPLOAD_SIDE, height: 1536, type: "image/jpeg" }]);
    expect(close).toHaveBeenCalled();
  });

  it("turns an iPhone HEIC photo into a JPEG where the browser can read it (Safari)", async () => {
    decodesTo(3024, 4032);
    const drawn = recordCanvas();

    const prepared = await prepareImage(photo("image/heic", 2_000_000, "IMG_0001.HEIC"), "player_avatar");

    expect(prepared.type).toBe("image/jpeg");
    expect(drawn[0]).toMatchObject({ width: 1536, height: MAX_UPLOAD_SIDE });
  });

  it("keeps a logo's transparency (PNG), trying smaller sizes before giving up", async () => {
    decodesTo(3000, 3000);
    const drawn = recordCanvas(MAX_IMAGE_UPLOAD_BYTES + 1);

    expect(await refusal(prepareImage(photo("image/png", MAX_IMAGE_UPLOAD_BYTES + 1), "club_logo"))).toBe(TOO_LARGE_MESSAGE);
    expect(drawn.map(({ width, type }) => [width, type])).toEqual([
      [2048, "image/png"],
      [1536, "image/png"],
      [1024, "image/png"],
    ]);
  });

  it("explains HEIC where the browser cannot read it, and refuses what is not a picture", async () => {
    decodesTo(0, 0, true);

    expect(await refusal(prepareImage(photo("image/heic"), "player_avatar"))).toBe(HEIC_MESSAGE);
    expect(await refusal(prepareImage(photo("image/bmp"), "player_avatar"))).toBe(UNREADABLE_IMAGE_MESSAGE);
    expect(await refusal(prepareImage(photo("application/pdf"), "player_avatar"))).toBe(UNSUPPORTED_TYPE_MESSAGE);
  });

  it("sends a JPEG, PNG or AVIF the browser cannot decode as it is: the server reads it (IMG-P3-01)", async () => {
    decodesTo(0, 0, true);
    const jpeg = photo("image/jpeg");
    const avif = photo("image/avif");

    await expect(prepareImage(jpeg, "player_avatar")).resolves.toBe(jpeg);
    await expect(prepareImage(avif, "club_banner")).resolves.toBe(avif);
    expect(await refusal(prepareImage(photo("image/jpeg", MAX_IMAGE_UPLOAD_BYTES + 1), "player_avatar"))).toBe(TOO_LARGE_MESSAGE);
  });

  it("still takes photos on a browser that refuses the orientation option, as iOS 15 does (IMG-P3-01)", async () => {
    const { decoder } = decodesTo(1600, 1200, false, { orientationOption: false });
    const drawn = recordCanvas();
    const jpeg = photo("image/jpeg");

    await expect(prepareImage(jpeg, "player_avatar")).resolves.toBe(jpeg);
    // A big one is still shrunk, from the bitmap the plain decode gives.
    await expect(prepareImage(photo("image/jpeg", MAX_IMAGE_UPLOAD_BYTES + 1), "player_avatar")).resolves.toMatchObject({ type: "image/jpeg" });
    expect(drawn).toHaveLength(1);
    expect(decoder).toHaveBeenLastCalledWith(expect.any(File));
  });

  it("shrinks with the browser's best resampling, onto white for a JPEG (IMG-P3-02, IMG-P3-03)", async () => {
    decodesTo(6000, 4000);
    recordCanvas();
    const calls = recordContext();

    await prepareImage(photo("image/png", MAX_IMAGE_UPLOAD_BYTES + 1), "tournament_banner");

    expect(calls.map(({ call }) => call)).toEqual(["fillRect", "drawImage"]);
    expect(calls[0]).toMatchObject({ fill: "#ffffff", args: [0, 0, MAX_UPLOAD_SIDE, 1365] });
    expect(calls[1].smoothing).toBe("high");
  });

  it("keeps a logo's transparent background transparent: no white fill for a PNG", async () => {
    decodesTo(4000, 4000);
    recordCanvas();
    const calls = recordContext();

    await prepareImage(photo("image/png", MAX_IMAGE_UPLOAD_BYTES + 1), "club_logo");

    expect(calls.map(({ call }) => call)).toEqual(["drawImage"]);
  });

  it("without a decoder, sends what the server takes and refuses the rest plainly", async () => {
    const jpeg = photo("image/jpeg");

    await expect(prepareImage(jpeg, "club_banner")).resolves.toBe(jpeg);
    expect(await refusal(prepareImage(photo("image/heif"), "player_avatar"))).toBe(HEIC_MESSAGE);
    expect(await refusal(prepareImage(photo("image/bmp"), "player_avatar"))).toBe(UNSUPPORTED_TYPE_MESSAGE);
    expect(await refusal(prepareImage(photo("image/jpeg", MAX_IMAGE_UPLOAD_BYTES + 1), "player_avatar"))).toBe(TOO_LARGE_MESSAGE);
  });
});

describe("cropForUpload (P3REV4-PERF-05)", () => {
  it("sends only the framed part of a player photo, at the 512 px the server keeps", async () => {
    decodesTo(2048, 1536);
    const drawn = recordCanvas(40_000);
    const calls = recordContext();

    const framed = await cropForUpload(photo("image/jpeg"), "player_avatar", { x: 0.25, y: 0.125, width: 0.5, height: 2 / 3 });

    expect(framed?.type).toBe("image/jpeg");
    expect(drawn).toEqual([{ width: 512, height: 512, type: "image/jpeg" }]);
    expect(calls[1].args.slice(1, 5)).toEqual([512, 192, 1024, 1024]);
  });

  it("never enlarges a small framed part, and keeps a banner's shape", async () => {
    decodesTo(1200, 800);
    const drawn = recordCanvas();

    await cropForUpload(photo("image/jpeg"), "club_banner", { x: 0, y: 0.25, width: 1, height: 0.5 });

    expect(drawn).toEqual([{ width: 1200, height: 400, type: "image/jpeg" }]);
  });

  it("leaves the cropping to the server where the browser cannot redraw the picture upright", async () => {
    decodesTo(1600, 1200, false, { orientationOption: false });

    await expect(cropForUpload(photo("image/jpeg"), "player_avatar", { x: 0, y: 0, width: 0.75, height: 1 })).resolves.toBeNull();
    await expect(cropForUpload(photo("image/png"), "club_logo", { x: 0, y: 0, width: 1, height: 1 })).resolves.toBeNull();
  });
});

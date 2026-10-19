import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { heicHeader, solidImage, SVG_IMAGE, type FixtureFormat } from "../../../test/helpers/images";
import { sniffImageFormat } from "./sniff";

function ftyp(major: string, ...compatible: string[]): Buffer {
  const box = Buffer.alloc(16 + compatible.length * 4);
  box.writeUInt32BE(box.length, 0);
  box.write(`ftyp${major}`, 4, "latin1");
  compatible.forEach((brand, index) => box.write(brand, 16 + index * 4, "latin1"));
  return box;
}

describe("sniffImageFormat", () => {
  it.each(["jpeg", "png", "gif", "webp", "avif"] as FixtureFormat[])("recognises %s by its bytes", async (format) => {
    expect(sniffImageFormat(await solidImage(8, 8, format))).toBe(format);
  });

  it("recognises HEIC, and AVIF by any of its brands", () => {
    expect(sniffImageFormat(heicHeader())).toBe("heic");
    expect(sniffImageFormat(ftyp("mif1", "heic"))).toBe("heic");
    expect(sniffImageFormat(ftyp("mif1", "miaf", "avif"))).toBe("avif");
    expect(sniffImageFormat(ftyp("avis"))).toBe("avif");
  });

  it.each([
    ["an SVG", SVG_IMAGE],
    ["text", Buffer.from("GIF8 but not quite")],
    ["an MP4 video", ftyp("isom", "mp42")],
    ["a truncated ftyp box", Buffer.from("\0\0\0\x18ftyp")],
    ["nothing", Buffer.alloc(0)],
  ])("does not take %s for an image", (_label, bytes) => {
    expect(sniffImageFormat(bytes)).toBeNull();
  });

  it("does not take a TIFF or a PDF for an image, though sharp could decode one", async () => {
    expect(sniffImageFormat(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).tiff().toBuffer())).toBeNull();
    expect(sniffImageFormat(Buffer.from("%PDF-1.7\n"))).toBeNull();
  });
});

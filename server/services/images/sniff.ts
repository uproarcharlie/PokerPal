/**
 * What an uploaded file really is, from its first bytes. Decoders pick a format by content, so this
 * runs before anything reaches sharp: only the formats we mean to accept are ever decoded (an SVG,
 * a TIFF or a PDF labelled image/png never reaches librsvg, libtiff or poppler).
 */

/** `heic` is recognised only so it can be refused with a clear message: sharp cannot decode HEVC. */
export type SniffedFormat = "jpeg" | "png" | "gif" | "webp" | "avif" | "heic";

const startsWith = (bytes: Buffer, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Buffer, start: number, end: number) => bytes.toString("latin1", start, end);

const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

/** ISO-BMFF (`....ftyp<major><minor><compatible...>`): AVIF if any brand says so, else HEIC/HEIF. */
function sniffFtyp(bytes: Buffer): SniffedFormat | null {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return null;
  const boxSize = Math.min(bytes.readUInt32BE(0), bytes.length);
  const brands = [ascii(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(bytes, offset, offset + 4));
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "avif";
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "heic";
  return null;
}

export function sniffImageFormat(bytes: Buffer): SniffedFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return sniffFtyp(bytes);
}

import { useState, type CSSProperties } from "react";
import { imageVariantsFromUrl } from "@shared/domain/images";
import { storedImageUrl } from "@/components/image/image-sources";
import { SmartImage } from "@/components/image/smart-image";
import { initials } from "@/lib/format";
import { px } from "./screen-plan";

/** A logo is drawn at most twice its own size: past that, a small one is a blur on a 40" TV. */
export const LOGO_UPSCALE_LIMIT = 2;

interface Size {
  width: number;
  height: number;
}

/**
 * A logo's own size in pixels. A stored upload offers every variant up to its largest (the URL kept),
 * which is exactly that many pixels on its longer side; the browser reports the variant it chose at
 * the box's size, so only its shape counts. An image stored before variants is what the file holds.
 */
export function nativeLogoSize(url: string, loaded: Size): Size | null {
  if (loaded.width <= 0 || loaded.height <= 0) return null;
  const variants = Object.keys(imageVariantsFromUrl(url) ?? {}).map(Number);
  // A single variant is drawn without a srcset (image-sources), so the browser's size is the file's.
  if (variants.length < 2) return loaded;
  const longest = Math.max(...variants);
  const shape = loaded.width / loaded.height;
  return shape >= 1 ? { width: longest, height: longest / shape } : { width: longest * shape, height: longest };
}

/** The most CSS pixels a logo of `native` size is drawn at on a screen of `pixelRatio`. */
export function logoLimit(native: Size, pixelRatio: number): Size {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  return { width: (native.width * LOGO_UPSCALE_LIMIT) / ratio, height: (native.height * LOGO_UPSCALE_LIMIT) / ratio };
}

interface TvLogoProps {
  name: string;
  imageUrl: string | null;
  /** The box the logo is fitted inside (CSS px). */
  width: number;
  height: number;
}

/**
 * The club's logo on the TV (round 5, item 24): fitted whole in its box (never cropped, a transparent
 * background left transparent), fetched at the variant the box needs on this screen (the box's size,
 * not a thumbnail's), with a soft light edge and the club's glow so a dark logo still reads on the dark
 * screen. A small logo is never blown up past twice its own size. The club's initials if it fails.
 */
export function TvLogo({ name, imageUrl, width, height }: TvLogoProps) {
  const url = storedImageUrl(imageUrl);
  const [native, setNative] = useState<(Size & { url: string }) | null>(null);
  const own = native !== null && native.url === url ? native : null;
  const limit = own ? logoLimit(own, window.devicePixelRatio) : null;
  const style: CSSProperties = {
    filter: `drop-shadow(0 0 ${px(Math.max(1, 0.02 * height))} rgb(var(--foreground) / 0.4)) drop-shadow(0 0 ${px(0.09 * height)} rgb(var(--primary) / 0.35))`,
    ...(limit ? { maxWidth: px(limit.width), maxHeight: px(limit.height) } : {}),
  };
  return (
    <div className="flex shrink-0 items-center justify-center" style={{ width: px(width), height: px(height) }} data-testid="display-logo">
      <SmartImage
        src={url}
        alt={`${name} logo`}
        width={Math.round(width)}
        height={Math.round(height)}
        sizes={`${String(Math.ceil(Math.max(width, height)))}px`}
        priority
        className="h-full w-full object-contain"
        style={style}
        onLoad={(event) => {
          const size = url ? nativeLogoSize(url, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }) : null;
          if (url && size) setNative({ url, ...size });
        }}
        fallback={
          <span role="img" aria-label={`${name} logo`} className="font-display font-black text-primary" style={{ fontSize: px(0.45 * height), lineHeight: 1 }}>
            {initials(name)}
          </span>
        }
      />
    </div>
  );
}

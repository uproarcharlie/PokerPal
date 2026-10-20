import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { imageSources, storedImageUrl } from "./image-sources";

export interface SmartImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "width" | "height" | "alt" | "onError"> {
  /** The stored URL; null, undefined and "" mean no image, and show `fallback`. */
  src: string | null | undefined;
  /** "" for an image the text beside it already names. */
  alt: string;
  /** The box it is drawn in, in CSS px: reserves the space before it loads and picks the variant. */
  width: number;
  height: number;
  /** The `sizes` hint; default: drawn at `width` px. */
  sizes?: string;
  /** Shown when there is no image or it fails to load (a deleted file, no connection). */
  fallback?: ReactNode;
  /** Above the fold (a page's hero): load at once instead of when scrolled near. */
  priority?: boolean;
}

/** A first failure is tried once more after this long: the venue's Wi-Fi may have dropped for a moment. */
export const IMAGE_RETRY_MS = 15_000;

/** The URL that failed, how many times, and whether the fallback is up while it waits to try again. */
interface Failure {
  url: string;
  count: number;
  waiting: boolean;
}

/**
 * Every stored image the app draws: the right-sized variant for the screen, lazy and async decoding by
 * default, and a fallback instead of a broken-image icon. A failure may be a dropped connection, not a
 * missing file (P3REV3-IMG-03): the picture is tried again once the browser is back online, and once
 * more a little later in any case; one that keeps failing while online keeps its fallback.
 */
export function SmartImage({ src, alt, width, height, sizes, fallback = null, priority = false, className, ...props }: SmartImageProps) {
  const url = storedImageUrl(src);
  const [failure, setFailure] = useState<Failure | null>(null);
  const failures = failure !== null && failure.url === url ? failure.count : 0;
  const waiting = failures > 0 && failure?.waiting === true;

  useEffect(() => {
    if (!waiting) return;
    // Back online: a fresh start, with its own later try. The later try keeps the count, so a second
    // failure while online is taken as a file that is gone.
    const online = () => setFailure((current) => (current ? { ...current, count: 0, waiting: false } : current));
    const later = () => setFailure((current) => (current ? { ...current, waiting: false } : current));
    window.addEventListener("online", online);
    const timer = failures === 1 ? setTimeout(later, IMAGE_RETRY_MS) : undefined;
    return () => {
      window.removeEventListener("online", online);
      clearTimeout(timer);
    };
  }, [waiting, failures]);

  if (!url || waiting) return <>{fallback}</>;
  const sources = imageSources(url);
  return (
    <img
      {...props}
      src={sources.src}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? (sizes ?? `${width}px`) : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailure({ url, count: failures + 1, waiting: true })}
      className={className}
    />
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SmartImage } from "./smart-image";

interface ClubBannerProps {
  imageUrl: string | null | undefined;
  /** "" when the banner is decoration (the club's name is the heading beside it). */
  alt?: string;
  /** What fills the 3:1 box without a banner, e.g. the club's logo on its colour. */
  fallback?: ReactNode;
  /** A page's hero: load at once. */
  priority?: boolean;
  className?: string;
}

/** A club's banner in a 3:1 box, cropped to fill it, with a fallback that keeps the same shape. */
export function ClubBanner({ imageUrl, alt = "", fallback, priority = false, className }: ClubBannerProps) {
  return (
    <div className={cn("relative aspect-[3/1] w-full overflow-hidden bg-muted", className)}>
      <SmartImage
        src={imageUrl}
        alt={alt}
        width={1280}
        height={427}
        sizes="100vw"
        priority={priority}
        className="absolute inset-0 h-full w-full object-cover"
        fallback={<div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">{fallback}</div>}
      />
    </div>
  );
}

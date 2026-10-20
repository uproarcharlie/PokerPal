import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SmartImage } from "./smart-image";

const SIZES = {
  sm: { px: 32, className: "h-8 w-8 text-xs" },
  md: { px: 48, className: "h-12 w-12 text-sm" },
  lg: { px: 64, className: "h-16 w-16 text-lg" },
  xl: { px: 80, className: "h-20 w-20 text-2xl" },
  "2xl": { px: 128, className: "h-32 w-32 text-4xl" },
} as const;

export type ClubLogoSize = keyof typeof SIZES;

interface ClubLogoProps {
  name: string;
  imageUrl: string | null | undefined;
  size?: ClubLogoSize;
  /** Whether the logo names the club itself (alt = "<name> logo"); false when the name is beside it. */
  labelled?: boolean;
  className?: string;
}

/**
 * A club's logo on a tile, fitted inside it whole (a wide or tall logo is never cropped), or the club's
 * initials ("CS" for Central Stars).
 */
export function ClubLogo({ name, imageUrl, size = "md", labelled = false, className }: ClubLogoProps) {
  const { px, className: sizeClass } = SIZES[size];
  const label = labelled ? `${name} logo` : "";
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-lg border border-border bg-card font-bold text-primary",
        sizeClass,
        className,
      )}
    >
      <SmartImage
        src={imageUrl}
        alt={label}
        width={px}
        height={px}
        className="h-full w-full object-contain p-0.5"
        fallback={
          <span aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label || undefined}>
            {initials(name)}
          </span>
        }
      />
    </span>
  );
}

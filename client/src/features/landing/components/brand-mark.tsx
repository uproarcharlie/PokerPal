import { SITE_NAME } from "@/app/page-meta";
// 96 px, twice the largest size drawn: sharp on high-density screens, about 9 KB (the 2048 px original is 770 KB).
import brandIcon from "@/assets/brand-icon.png";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { px: 24, className: "h-6 w-6" },
  md: { px: 32, className: "h-8 w-8" },
  lg: { px: 40, className: "h-10 w-10" },
  xl: { px: 48, className: "h-12 w-12" },
} as const;

interface BrandMarkProps {
  size?: keyof typeof SIZES;
  /** Writes the platform's name beside the icon (the icon is then decorative). */
  withName?: boolean;
  /** Classes for the name, e.g. its size. */
  nameClassName?: string;
  className?: string;
}

/** The LovePoker.club icon, with or without the name: the platform's mark on the sign-in, staff and marketing pages. */
export function BrandMark({ size = "md", withName = true, nameClassName, className }: BrandMarkProps) {
  const { px, className: sizeClass } = SIZES[size];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <img
        src={brandIcon}
        alt={withName ? "" : SITE_NAME}
        width={px}
        height={px}
        className={cn("shrink-0 rounded-lg object-contain", sizeClass)}
      />
      {withName ? <span className={cn("truncate font-bold text-foreground", nameClassName)}>{SITE_NAME}</span> : null}
    </span>
  );
}

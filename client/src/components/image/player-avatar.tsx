import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SmartImage } from "./smart-image";

const SIZES = {
  xs: { px: 24, className: "h-6 w-6 text-[10px]" },
  sm: { px: 32, className: "h-8 w-8 text-xs" },
  md: { px: 40, className: "h-10 w-10 text-sm" },
  lg: { px: 64, className: "h-16 w-16 text-xl" },
  xl: { px: 96, className: "h-24 w-24 text-3xl" },
} as const;

export type AvatarSize = keyof typeof SIZES;

interface PlayerAvatarProps {
  name: string;
  imageUrl: string | null | undefined;
  size?: AvatarSize;
  /**
   * Whether the avatar names the player itself (alt = name). Leave false when the name is written
   * beside it, so screen readers do not read it twice.
   */
  labelled?: boolean;
  className?: string;
}

/** A player's photo in a circle (always square, never squashed), or their initials. */
export function PlayerAvatar({ name, imageUrl, size = "md", labelled = false, className }: PlayerAvatarProps) {
  const { px, className: sizeClass } = SIZES[size];
  const label = labelled ? name : "";
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-muted-foreground",
        sizeClass,
        className,
      )}
    >
      <SmartImage
        src={imageUrl}
        alt={label}
        width={px}
        height={px}
        className="h-full w-full object-cover"
        fallback={
          <span aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label || undefined}>
            {initials(name)}
          </span>
        }
      />
    </span>
  );
}

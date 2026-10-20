import type { ReactNode } from "react";
import { Link } from "wouter";
import { routes } from "@/app/routes";
import { ClubLogo, type ClubLogoSize } from "@/components/image/club-logo";
import { cn } from "@/lib/utils";

interface ClubHeaderProps {
  club: { name: string; slug?: string | null; imageUrl?: string | null };
  /** The line under the name, e.g. the tournament's date; default "Poker club". */
  caption?: ReactNode;
  align?: "start" | "center";
  logoSize?: ClubLogoSize;
  className?: string;
}

/**
 * Which club a public page belongs to: its logo and name, linking to the club's page. The one place
 * every public page draws the club's identity, so a club's theme (Phase 5) restyles them all at once.
 * The page's own heading stays the page's: the name here is not a heading.
 */
export function ClubHeader({ club, caption = "Poker club", align = "center", logoSize = "lg", className }: ClubHeaderProps) {
  const body = (
    <>
      <ClubLogo name={club.name} imageUrl={club.imageUrl} size={logoSize} />
      <span className={cn("min-w-0", align === "center" ? "text-center sm:text-left" : "text-left")}>
        <span className="block break-words text-lg font-bold text-foreground">{club.name}</span>
        {caption ? <span className="block text-xs text-muted-foreground">{caption}</span> : null}
      </span>
    </>
  );
  const layout = cn(
    "flex items-center gap-3",
    align === "center" ? "flex-col justify-center sm:flex-row" : "justify-start",
    className,
  );

  if (!club.slug) return <div className={layout}>{body}</div>;
  return (
    <Link
      href={routes.publicClub(club.slug)}
      className={cn(layout, "rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {body}
    </Link>
  );
}

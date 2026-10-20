import type { ReactNode } from "react";
import type { ClubDto } from "@shared/api/public";
import { ClubLogo } from "@/components/image/club-logo";
import { cn } from "@/lib/utils";

/** The band every public page ends with: one place to restyle it (Phase 5's club themes: P3REV5-CQ-05). */
function FooterBand({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <footer className="mt-12 border-t border-border bg-card">
      <div className={cn("mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8", className)}>{children}</div>
    </footer>
  );
}

/**
 * The foot of a club's public page (the club's own page, a tournament's): the club's sign-off and the
 * platform's credit. While the club loads, the credit alone.
 */
export function PublicFooter({ club }: { club: Pick<ClubDto, "name" | "imageUrl"> | undefined }) {
  return (
    <FooterBand className="flex flex-col items-center justify-between gap-4 md:flex-row">
      <div className="flex items-center gap-3">
        {club ? <ClubLogo name={club.name} imageUrl={club.imageUrl} size="sm" /> : null}
        <div>
          {club ? <p className="font-semibold text-foreground">{club.name}</p> : null}
          <p className="text-xs text-muted-foreground">Powered by LovePoker.club</p>
        </div>
      </div>
      {club ? (
        <p className="text-center text-xs text-muted-foreground md:text-right">
          &copy; {new Date().getFullYear()} {club.name}. All rights reserved.
        </p>
      ) : null}
    </FooterBand>
  );
}

/** The foot of the platform's own public pages (the club directory). */
export function PlatformFooter() {
  return (
    <FooterBand className="text-center">
      <p className="text-sm text-muted-foreground">&copy; {new Date().getFullYear()} LovePoker.club - Where Poker Communities Thrive</p>
    </FooterBand>
  );
}

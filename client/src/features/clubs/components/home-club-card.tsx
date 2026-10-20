import { useMemo } from "react";
import { Link } from "wouter";
import type { ClubDto } from "@shared/api/public";
import { routes } from "@/app/routes";
import { ClubBanner } from "@/components/image/club-banner";
import { ClubLogo } from "@/components/image/club-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { richTextExcerpt } from "@/lib/rich-text";

/** How much of a club's description its card shows, as plain text. */
const EXCERPT_LENGTH = 100;

/**
 * A club on the club directory: its banner, name and a plain-text excerpt; the whole card opens the
 * club's page. Clubs have no banner of their own yet, so the banner box shows the logo whole on the
 * club's colours instead of cropping it.
 */
export function HomeClubCard({ club }: { club: ClubDto }) {
  const excerpt = useMemo(() => (club.description ? richTextExcerpt(club.description, EXCERPT_LENGTH) : ""), [club.description]);
  return (
    <Card className="relative flex h-full flex-col overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary">
      <ClubBanner imageUrl={null} fallback={<ClubLogo name={club.name} imageUrl={club.imageUrl} size="xl" />} />
      <CardHeader className="pb-2">
        <CardTitle as="h3" className="break-words text-xl">{club.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {excerpt ? <p className="line-clamp-2 text-sm text-muted-foreground">{excerpt}</p> : null}
        <div className="mt-auto pt-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={routes.publicClub(club.slug)} className="after:absolute after:inset-0">
              View Club<span className="sr-only"> {club.name}</span>
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

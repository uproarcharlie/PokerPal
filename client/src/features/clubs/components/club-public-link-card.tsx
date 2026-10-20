import { ExternalLink } from "lucide-react";
import { absoluteUrl, routes } from "@/app/routes";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** The club's public page address, to copy and share, and a way to open it. */
export function ClubPublicLinkCard({ slug }: { slug: string }) {
  const url = absoluteUrl(routes.publicClub(slug));
  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
      <CardContent className="flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-foreground">
            <ExternalLink className="h-5 w-5 text-primary" aria-hidden="true" />
            Public Club Page
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Share this link with members and on social media to let people view tournaments and register
          </p>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate text-sm text-foreground" data-testid="public-club-url">
              {url}
            </code>
            <CopyLinkButton value={url} variant="ghost" className="shrink-0" />
          </div>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            View Public Page
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

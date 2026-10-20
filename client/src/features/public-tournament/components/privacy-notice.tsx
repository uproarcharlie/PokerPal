import { routes } from "@/app/routes";

/**
 * What a player is told where they give their details (NZ Privacy Act 2020, principle 3; CC-06): what
 * is kept, who sees it, and where the full notice is. It opens in a new tab, so the form keeps what
 * was typed.
 */
export function PrivacyNotice() {
  return (
    <p className="text-xs text-muted-foreground" data-testid="privacy-notice">
      The club uses your name, phone number and photo to run its tournaments. Your name, photo and results appear on its public
      tournament pages and leaderboards; only the club&apos;s staff and the site&apos;s administrators see your phone number.{" "}
      <a
        href={routes.privacy()}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        How we look after your details
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </p>
  );
}

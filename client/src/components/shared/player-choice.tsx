import { forwardRef, type ReactNode } from "react";
import { Search } from "lucide-react";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The pieces of every "tap a player" list (the TD's bust, re-buy and add-on sheets; a player's own
 * request form on the QR page): the row's photo, name and line under it, and the box to find a name
 * in, matched with lib/name-search's one rule (R5REV3-CQ-03). Public-safe: the QR page draws them.
 */

/** The row's photo (initials without one), big enough to know someone by, the name, and a line under it. */
export function PlayerChoiceContent({ name, imageUrl, detail, alert = false }: { name: string; imageUrl: string | null | undefined; detail?: ReactNode; alert?: boolean }) {
  return (
    <>
      <PlayerAvatar name={name} imageUrl={imageUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium text-foreground">{name}</span>
        {/* The space keeps the name and the line under it apart in what a screen reader says. */}
        {detail ? (
          <>
            {" "}
            <span className={cn("block text-sm", alert ? "text-destructive" : "text-muted-foreground")}>{detail}</span>
          </>
        ) : null}
      </span>
    </>
  );
}

interface NameSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** Its accessible name ("Search players", "Find a name: Who is the re-buy for?"). */
  label: string;
  placeholder: string;
}

/** The box over a long list of players: a thumb's 44 px, the phone's search key. */
export const NameSearchBox = forwardRef<HTMLInputElement, NameSearchBoxProps>(function NameSearchBox({ value, onChange, label, placeholder }, ref) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={ref}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-11 pl-9 text-base"
      />
    </div>
  );
});

import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { NameSearchBox, PlayerChoiceContent } from "@/components/shared/player-choice";
import { Button } from "@/components/ui/button";
import { matchingNames } from "@/lib/name-search";
import { cn } from "@/lib/utils";

/** Longer lists than this get a box to find a name in. */
export const PICKER_SEARCH_FROM = 8;

/** One player the picker offers. */
export interface PlayerChoice {
  registration: PublicRegistration;
  /** Under the name: their counts, or why they cannot be chosen now. */
  detail?: string;
  disabled?: boolean;
}

interface PlayerPickerProps {
  /** The question the list answers ("Who is the re-buy for?"): it names the list. */
  label: string;
  choices: readonly PlayerChoice[];
  /** The chosen player's id, or "" for nobody yet. */
  value: string;
  onChange: (playerId: string) => void;
  /** Said instead of the list when nobody can be chosen. */
  empty: string;
  "data-testid"?: string;
}

const nameOf = (registration: PublicRegistration) => registration.player?.name ?? "Unknown player";

/**
 * Players to tap, each with their photo (or initials) beside their name so people know themselves
 * (round 5, items 6 and 14), and a box to find a name in once the list is long. The chosen player then
 * stands alone, photo large, with Change to pick again: the page stays short on a phone. Focus follows
 * the picker's own changes (to Change, or back to the list), never one made from outside.
 */
export function PlayerPicker({ label, choices, value, onChange, empty, "data-testid": testId }: PlayerPickerProps) {
  const labelId = useId();
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState("");
  const changeButton = useRef<HTMLButtonElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const moveFocus = useRef(false);

  const chosen = choices.find((choice) => choice.registration.playerId === value) ?? null;
  const view = chosen && !changing ? "chosen" : "list";
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    if (view === "chosen") changeButton.current?.focus();
    else (searchBox.current ?? list.current)?.focus();
  }, [view]);

  const choose = (playerId: string) => {
    moveFocus.current = true;
    setChanging(false);
    setQuery("");
    onChange(playerId);
  };
  const change = () => {
    moveFocus.current = true;
    setChanging(true);
  };

  const searchable = choices.length > PICKER_SEARCH_FROM;
  const shown = searchable ? matchingNames(choices, (choice) => nameOf(choice.registration), query) : choices;

  return (
    <div className="space-y-3" data-testid={testId}>
      <p id={labelId} className="text-base font-semibold text-foreground">
        {label}
      </p>
      {view === "chosen" && chosen ? (
        <div className="flex items-center gap-3 rounded-lg border-2 border-primary bg-primary/5 p-3" data-testid="chosen-player">
          <PlayerAvatar name={nameOf(chosen.registration)} imageUrl={chosen.registration.player?.imageUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold text-foreground">{nameOf(chosen.registration)}</p>
            {chosen.detail ? <p className="text-sm text-muted-foreground">{chosen.detail}</p> : null}
          </div>
          <Button ref={changeButton} type="button" variant="outline" className="h-11 shrink-0" onClick={change} aria-describedby={labelId}>
            Change
          </Button>
        </div>
      ) : choices.length === 0 ? (
        <p className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          {searchable ? <NameSearchBox ref={searchBox} value={query} onChange={setQuery} label={`Find a name: ${label}`} placeholder="Type a name" /> : null}
          {shown.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Nobody here is called &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul ref={list} tabIndex={-1} role="list" aria-labelledby={labelId} className="space-y-2 focus:outline-none">
              {shown.map(({ registration, detail, disabled = false }) => {
                const selected = registration.playerId === value;
                return (
                  <li key={registration.id}>
                    <button
                      type="button"
                      onClick={() => choose(registration.playerId)}
                      disabled={disabled}
                      aria-pressed={selected}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                      )}
                      data-testid={`pick-${registration.playerId}`}
                    >
                      <PlayerChoiceContent name={nameOf(registration)} imageUrl={registration.player?.imageUrl} detail={detail} />
                      {selected ? <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { NameSearchBox, PlayerChoiceContent } from "@/components/shared/player-choice";
import { matchingNames } from "@/lib/name-search";
import { cn } from "@/lib/utils";
import type { PublicRegistration } from "@shared/api/public";
import { playerName } from "../../player-name";

/** One player the picker offers. */
export interface PickerPlayer {
  registration: PublicRegistration;
  /** Under the name: their seat ("Table 2 · Seat 4"), or their counts ("1 of 2 re-buys"). */
  detail?: string | null;
  /** Why they cannot be chosen now ("Limit reached"), shown in place of the detail; null when they can. */
  unavailable?: string | null;
}

/** Players under a heading ("At Table 2"), or without one (null). */
export interface PickerGroup {
  label: string | null;
  players: readonly PickerPlayer[];
}

interface DeskPlayerPickerProps {
  groups: readonly PickerGroup[];
  onPick: (registration: PublicRegistration) => void;
  /** The player whose choice is being saved: their row says so, and every row ignores taps meanwhile. */
  busyId?: string | null;
  /** Above the list and never filtered out: the "Not recorded" choice. */
  before?: ReactNode;
  /** Said when nobody is offered at all. */
  empty: string;
  testId: string;
}

/**
 * The TD's way to choose a player on a phone (the bust, re-buy and add-on sheets): each one a
 * whole-width row, 56 px tall, with their photo (initials without one) big enough to know them by, in
 * groups ("At Table 2"), and a search box over the list for a big field that finds names as every other
 * "find a name" box does (lib/name-search: word starts, any case or accent; R5REV3-CQ-03). Rows are
 * buttons: a tap chooses at once (round5-contracts §8.1: a bust is three taps).
 */
export function DeskPlayerPicker({ groups, onPick, busyId = null, before, empty, testId }: DeskPlayerPickerProps) {
  const [search, setSearch] = useState("");
  const shown = groups
    .map((group) => ({ ...group, players: matchingNames(group.players, (player) => playerName(player.registration), search) }))
    .filter((group) => group.players.length > 0);
  const offered = groups.some((group) => group.players.length > 0);

  return (
    <div className="space-y-3" data-testid={testId}>
      {offered ? <NameSearchBox value={search} onChange={setSearch} label="Search players" placeholder="Search players" /> : null}
      {before}
      {shown.map((group) => (
        <div key={group.label ?? "players"}>
          {group.label ? <h3 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3> : null}
          <ul role="list" className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {group.players.map(({ registration, detail, unavailable }) => {
              const name = playerName(registration);
              const busy = busyId === registration.id;
              return (
                <li key={registration.id}>
                  <button
                    type="button"
                    disabled={Boolean(unavailable)}
                    aria-disabled={busyId !== null || undefined}
                    onClick={() => {
                      if (busyId === null) onPick(registration);
                    }}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60",
                      busyId === null && !unavailable && "hover:bg-muted active:bg-muted",
                      busy && "bg-muted",
                    )}
                    data-testid={`${testId}-${registration.id}`}
                  >
                    <PlayerChoiceContent name={name} imageUrl={registration.player?.imageUrl} detail={unavailable ?? detail} alert={Boolean(unavailable)} />
                    {busy ? (
                      <>
                        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                        <span className="sr-only">Saving…</span>
                      </>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!offered ? <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{empty}</p> : null}
      {offered && shown.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground" role="status">
          Nobody called “{search.trim()}”.
        </p>
      ) : null}
    </div>
  );
}

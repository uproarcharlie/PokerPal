import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { TournamentMoney } from "@/lib/prize-pool";
import { ManualPoolEditor, MaxPlayersEditor } from "./stat-editors";

interface StatsStripProps {
  tournament: TournamentDetailDto;
  money: TournamentMoney;
  totalPlayers: number;
  rakeLabel: string;
  /** The club's staff, while the tournament is open, may change the max players. */
  canEditPlayers: boolean;
  /** ...and the prize pool, until the pool is locked. */
  canEditPool: boolean;
}

function StatTile({ label, edit, children }: { label: string; edit?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3 md:p-4">
      <div className="mb-1 flex min-h-5 items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {edit}
      </div>
      {children}
    </div>
  );
}

const STAT = "text-xl font-bold text-foreground tabular-nums md:text-2xl";

/** Why the headline pool is the figure it is, beside it. */
function poolNote({ display, breakdown }: TournamentMoney, rakeLabel: string): string | null {
  if (display.source === "live" && breakdown.netSource === "manual_pool") return "(manual)";
  if (display.source === "live" && breakdown.netSource === "ap_override") return `(manual ${rakeLabel})`;
  if (display.source === "snapshot" || display.source === "stored") return "(paid)";
  if (display.source === "unrecorded") return "(estimated: prizes not recorded)";
  if (display.source === "cancelled") return "(cancelled: no prizes)";
  return null;
}

/** The figures the TD reads out: players, the pool, and the entries it is made of. */
export function StatsStrip({ tournament, money, totalPlayers, rakeLabel, canEditPlayers, canEditPool }: StatsStripProps) {
  const [editing, setEditing] = useState<"players" | "pool" | null>(null);
  const counts = money.breakdown.counts;
  const note = poolNote(money, rakeLabel);
  const toggle = (which: "players" | "pool") => setEditing((open) => (open === which ? null : which));
  // A saved editor goes, with the box and Save the TD was on: focus goes back to its tile's Edit (MA-P3REV1-04).
  const editPlayers = useRef<HTMLButtonElement>(null);
  const editPool = useRef<HTMLButtonElement>(null);
  const playersSaved = () => {
    setEditing(null);
    editPlayers.current?.focus();
  };
  const poolSaved = () => {
    setEditing(null);
    editPool.current?.focus();
  };

  return (
    <section aria-label="Tournament figures" className="grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-4">
      <StatTile
        label="Players"
        edit={
          canEditPlayers ? (
            <Button
              ref={editPlayers}
              variant="ghost"
              size="sm"
              className="-my-2 h-10 px-3"
              onClick={() => toggle("players")}
              aria-expanded={editing === "players"}
              aria-label={editing === "players" ? "Cancel editing max players" : "Edit max players"}
              data-testid="edit-max-players"
            >
              {editing === "players" ? "Cancel" : "Edit"}
            </Button>
          ) : null
        }
      >
        {editing === "players" && canEditPlayers ? (
          <MaxPlayersEditor tournamentId={tournament.id} current={tournament.maxPlayers} onDone={playersSaved} />
        ) : (
          <p className={STAT} data-testid="players-count">
            {totalPlayers}/{tournament.maxPlayers}
          </p>
        )}
      </StatTile>

      <StatTile
        label="Prize Pool"
        edit={
          canEditPool ? (
            <Button
              ref={editPool}
              variant="ghost"
              size="sm"
              className="-my-2 h-10 px-3"
              onClick={() => toggle("pool")}
              aria-expanded={editing === "pool"}
              aria-label={editing === "pool" ? "Cancel editing the prize pool" : "Edit prize pool"}
              data-testid="edit-prize-pool"
            >
              {editing === "pool" ? "Cancel" : "Edit"}
            </Button>
          ) : null
        }
      >
        {editing === "pool" && canEditPool ? (
          <ManualPoolEditor
            tournamentId={tournament.id}
            current={tournament.manualPrizePool}
            calculatedCents={money.breakdown.netAfterAp}
            onDone={poolSaved}
          />
        ) : (
          <p className={STAT} data-testid="prize-pool">
            {formatMoney(money.poolCents)}
            {note ? <span className="ml-2 text-xs font-normal text-muted-foreground">{note}</span> : null}
          </p>
        )}
      </StatTile>

      <StatTile label="Buy-ins">
        <p className={STAT} data-testid="total-buyins">
          {counts.buyIns}
        </p>
      </StatTile>
      <StatTile label="Re-buys">
        <p className={STAT} data-testid="total-rebuys">
          {counts.rebuys}
        </p>
      </StatTile>
      <StatTile label="Add-ons">
        <p className={STAT} data-testid="total-addons">
          {counts.addons}
        </p>
      </StatTile>
    </section>
  );
}

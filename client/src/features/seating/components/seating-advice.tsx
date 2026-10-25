import type { ReactNode } from "react";
import { Scale, Split, Trophy } from "lucide-react";
import type { SeatingDto, TableDto } from "@shared/api/seating";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { seatText } from "../seating-text";

interface SeatingAdviceProps {
  seating: SeatingDto;
  busy: boolean;
  /** Applies the balancing moves listed (with the seating version they were worked out from). */
  onBalance: () => void;
  onBreak: (table: TableDto) => void;
  onFinalTable: (table: TableDto) => void;
}

function Advice({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 shrink-0 text-primary" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">{title}</p>
          <div className="text-sm text-muted-foreground">{children}</div>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/** "Table 1 has 9 players, Table 3 has 7": the fullest and emptiest active tables. */
function unevenText(tables: readonly TableDto[]): string {
  const active = tables.filter((table) => table.status === "active");
  const fullest = active.reduce((best, table) => (table.occupied > best.occupied ? table : best), active[0]);
  const emptiest = active.reduce((best, table) => (table.occupied < best.occupied ? table : best), active[0]);
  return `${fullest.displayName} has ${plural(fullest.occupied, "player")}, ${emptiest.displayName} has ${emptiest.occupied}.`;
}

/**
 * What the seating suggests doing next, worked out by the server between polls: the final table once
 * everyone still in fits at one (it then stands in for breaking a table), a table to break once its
 * players fit at the others, and the moves that even the tables out. Balancing is applied exactly as
 * listed: if the seating changed since, the server refuses and the screen refreshes.
 */
export function SeatingAdvice({ seating, busy, onBalance, onBreak, onFinalTable }: SeatingAdviceProps) {
  const { balance, breakTable, finalTable } = seating.suggestions;
  const tableById = new Map(seating.tables.map((table) => [table.id, table]));
  const finalAt = finalTable ? tableById.get(finalTable.tableId) : undefined;
  const toBreak = !finalAt && breakTable ? tableById.get(breakTable.tableId) : undefined;
  if (!finalAt && !toBreak && balance.length === 0) return null;

  return (
    <section aria-label="Suggestions" className="space-y-3" data-testid="seating-advice">
      {finalAt ? (
        <Advice
          icon={<Trophy className="h-5 w-5" />}
          title="Final table!"
          action={
            <Button type="button" busy={busy} onClick={() => onFinalTable(finalAt)}>
              Draw the final table
            </Button>
          }
        >
          Everyone still in ({plural(seating.stats.activePlayers, "player")}) fits at {finalAt.displayName}.
        </Advice>
      ) : null}
      {toBreak && breakTable ? (
        <Advice
          icon={<Split className="h-5 w-5" />}
          title={`${toBreak.displayName} can be broken`}
          action={
            <Button type="button" variant="outline" busy={busy} onClick={() => onBreak(toBreak)}>
              Break {toBreak.displayName}
            </Button>
          }
        >
          Its {plural(breakTable.playersToMove, "player")} fit at the other tables.
        </Advice>
      ) : null}
      {balance.length > 0 ? (
        <Advice
          icon={<Scale className="h-5 w-5" />}
          title={`Tables are uneven: move ${plural(balance.length, "player")}`}
          action={
            <Button type="button" busy={busy} onClick={onBalance} data-testid="apply-balance">
              Apply
            </Button>
          }
        >
          <p>{unevenText(seating.tables)}</p>
          <ul role="list" className="mt-1 space-y-0.5">
            {balance.map((move) => (
              <li key={move.registrationId}>
                <span className="font-medium text-foreground">{move.playerName}</span>: {move.from ? seatText(move.from) : "no seat"} → {move.to ? seatText(move.to) : "no seat"}
              </li>
            ))}
          </ul>
        </Advice>
      ) : null}
    </section>
  );
}

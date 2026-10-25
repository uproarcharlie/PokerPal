import type { ReactNode } from "react";
import { Armchair, Plus, Scale, Split, Trophy, UserPlus } from "lucide-react";
import type { SeatingDto, SeatMoveDto, TableAdviceDto, TableDto } from "@shared/api/seating";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { waitingToSeat } from "../paid-only";
import { leftWaitingText, seatText, tablesText } from "../seating-text";

interface SeatingAdviceProps {
  seating: SeatingDto;
  busy: boolean;
  /** The device's "Paid players only": seating the waiting leaves out those who have not paid. */
  paidOnly: boolean;
  /** Opens the table the advice names and makes its moves (exactly those: the seating version goes with them). */
  onOpenTable: () => void;
  onSeatWaiting: () => void;
  /** Applies the balancing moves listed (with the seating version they were worked out from). */
  onBalance: () => void;
  onBreak: (table: TableDto) => void;
  onFinalTable: (table: TableDto) => void;
}

const ICONS: Record<TableAdviceDto["kind"], ReactNode> = {
  open_table: <Plus className="h-5 w-5" />,
  seat_waiting: <UserPlus className="h-5 w-5" />,
  final_table: <Trophy className="h-5 w-5" />,
  break_table: <Split className="h-5 w-5" />,
  balance: <Scale className="h-5 w-5" />,
};

/** "Alice Smith: Table 1, Seat 9 → Table 3, Seat 2", or "Late Larry sits down at Table 3, Seat 4". */
export const adviceMoveText = (move: SeatMoveDto): string =>
  move.from ? `${move.playerName}: ${seatText(move.from)} → ${move.to ? seatText(move.to) : "no seat"}` : `${move.playerName} sits down at ${move.to ? seatText(move.to) : "no seat"}`;

/**
 * "Tables 1 and 2 have 7 players, Table 3 has 5": every active table at the occupancies the balancing
 * moves take players from and to, fullest first, so the sentence names the tables the moves come from
 * (LEAD-SEAT-BANNER), never just the first of the fullest.
 */
export function unevenText(tables: readonly TableDto[], moves: readonly SeatMoveDto[]): string {
  const active = tables.filter((table) => table.status === "active");
  const moved = new Set(moves.flatMap((move) => [move.from?.tableId, move.to?.tableId]));
  const counts = new Set(active.filter((table) => moved.has(table.id)).map((table) => table.occupied));
  const groups = Array.from(counts)
    .sort((a, b) => b - a)
    .map((occupied) => ({ occupied, tables: active.filter((table) => table.occupied === occupied).sort((a, b) => a.tableNumber - b.tableNumber) }));
  const parts = groups.map(({ occupied, tables: group }, i) => `${tablesText(group)} ${group.length === 1 ? "has" : "have"} ${i === 0 ? plural(occupied, "player") : occupied}`);
  return parts.length > 0 ? `${parts.join(", ")}.` : "";
}

/** "1 player sits down, 6 players move across" for an opened table's plan. */
export function openTableSummary(moves: readonly SeatMoveDto[]): string {
  const seated = moves.filter((move) => move.from === null).length;
  const moved = moves.length - seated;
  const parts = [...(seated > 0 ? [`${plural(seated, "player sits", "players sit")} down`] : []), ...(moved > 0 ? [`${plural(moved, "player moves", "players move")} across`] : [])];
  return parts.length > 0 ? `${parts.join(", ")}.` : "Nobody needs to move.";
}

function MoveList({ moves, testId }: { moves: readonly SeatMoveDto[]; testId: string }) {
  return (
    <ul role="list" className="mt-1 space-y-0.5" data-testid={testId}>
      {moves.map((move) => (
        <li key={move.registrationId} className="break-words">
          {adviceMoveText(move)}
        </li>
      ))}
    </ul>
  );
}

interface AdviceCardProps {
  advice: TableAdviceDto;
  lead: boolean;
  title: string;
  action: ReactNode;
  children?: ReactNode;
}

/** One piece of advice: what to do, the server's one plain sentence on why, and the one tap that does it. */
function AdviceCard({ advice, lead, title, action, children }: AdviceCardProps) {
  return (
    <div
      className={cn("flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between", lead ? "border-primary/50 bg-primary/5" : "border-border bg-card")}
      data-testid={`advice-${advice.kind}`}
    >
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 shrink-0 text-primary" aria-hidden="true">
          {ICONS[advice.kind]}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{advice.message}</p>
          {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
        </div>
      </div>
      <div className="shrink-0 [&>button]:min-h-11 [&>button]:w-full sm:[&>button]:w-auto">{action}</div>
    </div>
  );
}

/**
 * What the table advisor (shared/domain/table-advisor, worked out by the server between polls) says to
 * do with the tables now, most urgent first: open the next table (seating the waiting and evening the
 * tables out, its moves listed before the tap), seat the waiting, draw the final table, break a table,
 * balance. Each is one tap and applies exactly what is shown (the seating version goes with it: a
 * seating changed meanwhile is refused and the screen refreshes); nothing moves without the tap. Under
 * the advice: players registered but not arrived yet ("once they've paid"), and the waiting list
 * behind a full field (round 5, item 15), who are seated only once a place opens and they are accepted.
 */
export function SeatingAdvice({ seating, busy, paidOnly, onOpenTable, onSeatWaiting, onBalance, onBreak, onFinalTable }: SeatingAdviceProps) {
  const { advisor } = seating;
  const tableById = new Map(seating.tables.map((table) => [table.id, table]));
  const toSeat = waitingToSeat(seating.stats, paidOnly);
  // Seating the waiting means nothing with only unpaid players waiting and "Paid players only" on.
  const shown = advisor.advice.filter((advice) => advice.kind !== "seat_waiting" || toSeat > 0);
  const flags = [
    ...(advisor.notArrived > 0 ? [`${plural(advisor.notArrived, "player")} registered, not arrived yet: seated once they've paid.`] : []),
    ...(advisor.overCapacity > 0 ? [`${advisor.overCapacity} on the waiting list: seated once a place opens and they're accepted.`] : []),
  ];
  if (shown.length === 0 && flags.length === 0) return null;
  // Breaking a table and the final table plan around the players at the tables: say who they leave waiting (TDN4-FINAL-TABLE-WORDS).
  const leftWaiting = leftWaitingText(seating.stats);

  return (
    <section aria-label="Suggestions" className="space-y-3" data-testid="seating-advice">
      {shown.map((advice, index) => {
        const lead = index === 0;
        const table = advice.tableId ? tableById.get(advice.tableId) : undefined;
        switch (advice.kind) {
          case "open_table":
            return (
              <AdviceCard
                key={advice.kind}
                advice={advice}
                lead={lead}
                title={`Open Table ${advice.tableNumber ?? ""}`.trim()}
                action={
                  <Button type="button" busy={busy} onClick={onOpenTable} data-testid="apply-open-table">
                    <Armchair aria-hidden="true" />
                    Open Table {advice.tableNumber}
                  </Button>
                }
              >
                <p className="font-medium text-foreground">{openTableSummary(advice.moves)}</p>
                {advice.moves.length > 0 ? (
                  <details className="mt-1">
                    <summary className="flex min-h-11 cursor-pointer items-center font-medium text-foreground">Show who moves ({advice.moves.length})</summary>
                    <MoveList moves={advice.moves} testId="open-table-moves" />
                  </details>
                ) : null}
              </AdviceCard>
            );
          case "seat_waiting":
            return (
              <AdviceCard
                key={advice.kind}
                advice={advice}
                lead={lead}
                title={`Seat ${toSeat} waiting`}
                action={
                  <Button type="button" busy={busy} onClick={onSeatWaiting} data-testid="advice-seat-waiting">
                    Seat them
                  </Button>
                }
              />
            );
          case "final_table":
            return table ? (
              <AdviceCard
                key={advice.kind}
                advice={advice}
                lead={lead}
                title="Final table!"
                action={
                  <Button type="button" busy={busy} onClick={() => onFinalTable(table)}>
                    Draw the final table
                  </Button>
                }
              >
                {leftWaiting ? <p>{leftWaiting}</p> : null}
              </AdviceCard>
            ) : null;
          case "break_table":
            return table ? (
              <AdviceCard
                key={advice.kind}
                advice={advice}
                lead={lead}
                title={`${table.displayName} can be broken`}
                action={
                  <Button type="button" variant={lead ? "default" : "outline"} busy={busy} onClick={() => onBreak(table)}>
                    Break {table.displayName}
                  </Button>
                }
              >
                {leftWaiting ? <p>{leftWaiting}</p> : null}
              </AdviceCard>
            ) : null;
          case "balance":
            return (
              <AdviceCard
                key={advice.kind}
                advice={advice}
                lead={lead}
                title={`Tables are uneven: move ${plural(advice.moves.length, "player")}`}
                action={
                  <Button type="button" busy={busy} onClick={onBalance} data-testid="apply-balance">
                    Apply
                  </Button>
                }
              >
                <p>{unevenText(seating.tables, advice.moves)}</p>
                <MoveList moves={advice.moves} testId="balance-moves" />
              </AdviceCard>
            );
        }
      })}
      {flags.map((flag) => (
        <p key={flag} className="rounded-md bg-muted px-3 py-2 text-sm text-foreground" data-testid="advisor-flag">
          {flag}
        </p>
      ))}
    </section>
  );
}

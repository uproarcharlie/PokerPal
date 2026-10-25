import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { PoolLine } from "@/features/tournaments/components/prize-pool/pool-lines";
import { formatMoney, formatTime } from "@/lib/format";
import { clubTake } from "@/lib/prize-pool";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import { offersAddons, offersHighHand, offersRebuys } from "@shared/domain/player-actions";
import { carryTargetName, differenceLines, type DifferenceLine } from "@shared/domain/prize-difference";
import type { NetSource } from "@shared/domain/prize-pool";
import { rateText } from "@shared/domain/rake-rates";

type FrozenPool = NonNullable<TournamentDetailDto["prizePoolSnapshot"]>["pool"];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** Where the prize pool comes from: the rates, a fixed AP total, or a fixed pool. */
function SourceBadge({ source, label }: { source: NetSource; label: string }) {
  const text = source === "manual_pool" ? "Pool fixed" : source === "ap_override" ? `${label} fixed` : "Calculated";
  return (
    <Badge variant={source === "calculated" ? "outline" : "secondary"} className="ml-2 align-middle" data-testid="net-source">
      {text}
    </Badge>
  );
}

interface TakeLineProps {
  impliedCents: Cents;
  source: NetSource;
  label: string;
  note?: ReactNode;
  /** Lines above say what the club kept of, or added to, the prizes as set: the result is then the club's take in all. */
  inAll?: boolean;
}

/** What the club keeps (or adds) in the end, with where the pool comes from: the figure the pool card beside it takes off. */
function TakeLine({ impliedCents, source, label, note, inAll = false }: TakeLineProps) {
  const take = inAll
    ? { label: impliedCents < 0 ? "The club puts in, in all" : "The club keeps, in all", cents: Math.abs(impliedCents) }
    : clubTake({ impliedCents, netSource: source }, label);
  return (
    <PoolLine
      label={
        <>
          {take.label}
          <SourceBadge source={source} label={label} />
        </>
      }
      note={note}
      value={formatMoney(take.cents)}
      tone="result"
      testId="ap-take"
    />
  );
}

/** The difference lines that change what the club keeps or adds (round 5, item 16); the rest are the prize pool card's. */
const TAKE_LINES: Readonly<Partial<Record<DifferenceLine["kind"], { sign: string; note: string }>>> = {
  kept_by_club: { sign: "+", note: "Left over from the prizes as set" },
  carried_over: { sign: "", note: "Not the club's: a later tournament can add it to its prize pool" },
  added_by_club: { sign: "−", note: "The prizes as set are more than the money available" },
};

function DifferenceTakeLines({ lines }: { lines: readonly DifferenceLine[] }) {
  return (
    <>
      {lines.map((line) => {
        const shown = TAKE_LINES[line.kind];
        return shown ? (
          <PoolLine key={line.kind} label={line.label} note={shown.note} value={`${shown.sign}${formatMoney(line.cents)}`} testId={`ap-${line.kind.replaceAll("_", "-")}`} />
        ) : null;
      })}
    </>
  );
}

/** The manual AP total, fixed at its amount beside what the rates give. */
function OverrideLine({ overrideCents, calculatedCents, label, grows }: { overrideCents: Cents; calculatedCents: Cents; label: string; grows: boolean }) {
  const note = `Fixed at ${formatMoney(overrideCents)} (calculated ${formatMoney(calculatedCents)})${grows ? ": it does not grow with later entries" : ""}`;
  return <PoolLine label={`${label} (manual total)`} note={note} value={formatMoney(overrideCents)} tone="total" testId="ap-override" />;
}

interface HighHandGroupProps {
  tournament: TournamentDetailDto;
  /** The server's high-hand figures (shared/domain), the ones finalize records and the pool card shows. */
  highHand: PrizePoolDto["breakdown"]["highHand"];
  label: string;
}

/** The high hand's own AP, a separate pot never part of the AP above; nothing for a tournament without one. */
function HighHandGroup({ tournament, highHand, label }: HighHandGroupProps) {
  if (!offersHighHand(tournament)) return null;
  return (
    <Group title="High hand (a separate pot)">
      <PoolLine
        label={`${label}: ${rateText(tournament.highHandRakeType, tournament.highHandRakeAmount, true)}`}
        note={highHand.entrants === 0 ? `Nobody is in the high hand yet. Never part of the ${label} above` : `Never part of the ${label} above`}
        value={formatMoney(highHand.rake)}
        testId="ap-rake-high-hand"
      />
    </Group>
  );
}

interface LiveBreakdownProps {
  tournament: TournamentDetailDto;
  prizePool: PrizePoolDto;
  label: string;
  timeZone: string;
}

/**
 * The AP as finalize would work it out now (the server's breakdown): each component's AP with its rule,
 * the calculated AP, the manual AP total, and what the club keeps (or adds under a pool fixed by hand),
 * with the high hand's own AP as the server works it out (shared/domain, never again here:
 * P4REV4-R3-CQ-01). What came in and the pool to pay are the prize pool card's, beside this one: the
 * Overview shows each figure once (P4REV4-CQ-02).
 */
export function LiveBreakdown({ tournament, prizePool, label, timeZone }: LiveBreakdownProps) {
  const { breakdown } = prizePool;
  const { rake } = breakdown;
  // The reason belongs to a pool or AP total fixed by hand: once the pool is calculated again (a rates
  // change let the fixed total go), it no longer explains the figures beside it (P4REV2-MONEY-02).
  const adjustment = breakdown.netSource === "calculated" ? null : prizePool.adjustment;
  const fixedPool =
    breakdown.manualPrizePool !== null
      ? `The prize pool is fixed by hand at ${formatMoney(breakdown.manualPrizePool)} (the rates leave ${formatMoney(breakdown.netAfterAp)})`
      : undefined;
  const lines = differenceLines(breakdown, prizePool.carryTarget).filter((line) => TAKE_LINES[line.kind]);
  return (
    <div className="space-y-5">
      <Group title={`${label} by rule`}>
        <PoolLine label={`Buy-ins: ${rateText(tournament.rakeType, tournament.rakeAmount)}`} value={formatMoney(rake.buyIn)} testId="ap-rake-buyins" />
        {offersRebuys(tournament) ? (
          <PoolLine label={`Re-buys: ${rateText(tournament.rebuyRakeType, tournament.rebuyRakeAmount)}`} value={formatMoney(rake.rebuy)} testId="ap-rake-rebuys" />
        ) : null}
        {offersAddons(tournament) ? (
          <PoolLine label={`Add-ons: ${rateText(tournament.addonRakeType, tournament.addonRakeAmount)}`} value={formatMoney(rake.addon)} testId="ap-rake-addons" />
        ) : null}
        <PoolLine label={`Calculated ${label}`} value={formatMoney(rake.calculated)} tone="total" testId="ap-calculated" />
        {rake.override !== null ? <OverrideLine overrideCents={rake.override} calculatedCents={rake.calculated} label={label} grows /> : null}
        <DifferenceTakeLines lines={lines} />
        <TakeLine impliedCents={breakdown.impliedRake} source={breakdown.netSource} label={label} note={fixedPool} inAll={lines.length > 0} />
      </Group>

      {adjustment ? (
        <p className="text-xs text-muted-foreground" data-testid="ap-adjustment">
          Changed by hand at {formatTime(adjustment.adjustedAt, timeZone)}
          {adjustment.reason ? `: ${adjustment.reason}` : ""}
        </p>
      ) : null}

      <HighHandGroup tournament={tournament} highHand={breakdown.highHand} label={label} />
    </div>
  );
}

interface FrozenBreakdownProps {
  tournament: TournamentDetailDto;
  pool: FrozenPool;
  /** The high hand's figures: finalize freezes none of them, and a completed game's entries no longer change. */
  highHand: PrizePoolDto["breakdown"]["highHand"];
  label: string;
}

/**
 * What finalize froze (D20) of the AP: never worked out again, whatever the rates say now; and the high
 * hand's own AP, still shown once the game is over, so the club's take does not look smaller after
 * finalize than during the game (P4REV2R2-MONEY-03).
 */
export function FrozenBreakdown({ tournament, pool, highHand, label }: FrozenBreakdownProps) {
  const fixedPool = pool.manualPrizePoolCents !== null ? `The prize pool was fixed by hand at ${formatMoney(pool.manualPrizePoolCents)}` : undefined;
  // Snapshots from before round 5 record no difference: their take line says it as it always has.
  const lines = differenceLines(pool, pool.difference?.carryTarget ?? carryTargetName(null)).filter((line) => TAKE_LINES[line.kind]);
  return (
    <div className="space-y-5">
      <Group title="As finalized">
        <PoolLine label={`Calculated ${label}`} value={formatMoney(pool.rakeCalculatedCents)} testId="ap-calculated" />
        {pool.rakeOverrideCents !== null ? (
          <OverrideLine overrideCents={pool.rakeOverrideCents} calculatedCents={pool.rakeCalculatedCents} label={label} grows={false} />
        ) : null}
        <DifferenceTakeLines lines={lines} />
        <TakeLine impliedCents={pool.impliedRakeCents} source={pool.netSource} label={label} note={fixedPool} inAll={lines.length > 0} />
      </Group>
      <HighHandGroup tournament={tournament} highHand={highHand} label={label} />
    </div>
  );
}

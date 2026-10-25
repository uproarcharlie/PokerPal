import { useId } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Check, CheckCircle2, Clock, Hourglass, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { formatMoney, formatTime, plural } from "@/lib/format";
import type { ConfirmedRegistrationDto, PendingRegistrationDto, StaffRegistrationDto } from "@shared/api/registrations";
import { toCents } from "@shared/domain/money";
import { waitingListPlaceOf } from "@/features/public-tournament/waiting-list";
import { playerName } from "../../player-name";

/** A phone number for the player's own club; another club's player keeps theirs (ClubPlayer.canEdit). */
const phoneOf = (registration: StaffRegistrationDto) =>
  registration.player?.canEdit === false ? "Other club" : registration.player?.phone || "N/A";

function HighHands({ entering }: { entering: boolean | null }) {
  return entering ? (
    <Badge variant="secondary">
      <Trophy className="mr-1 h-3 w-3" aria-hidden="true" />
      Yes
    </Badge>
  ) : (
    <Badge variant="outline">No</Badge>
  );
}

/** The early-bird bonus (chips only, never money), given or taken back one player at a time from either list. */
export interface EarlyBirdToggle {
  /** The registrations whose change is being saved: their switch waits for the server. */
  busy: ReadonlySet<string>;
  onChange: (registrationId: string, earlyBird: boolean) => void;
}

function EarlyBirdSwitch({ registration, toggle }: { registration: StaffRegistrationDto; toggle: EarlyBirdToggle }) {
  const id = useId();
  const busy = toggle.busy.has(registration.id);
  return (
    // The label makes the whole row the target (44 px on a phone); the switch itself is smaller.
    <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 md:min-h-10">
      <Switch
        id={id}
        checked={registration.earlyBird}
        aria-disabled={busy || undefined}
        onCheckedChange={(checked) => {
          if (!busy) toggle.onChange(registration.id, checked);
        }}
        data-testid={`early-bird-${registration.id}`}
      />
      <span className="sr-only">Early-bird bonus for {playerName(registration)}</span>
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        {registration.earlyBird ? "Yes" : "No"}
      </span>
    </label>
  );
}

const earlyBirdColumn = <T extends StaffRegistrationDto>(toggle: EarlyBirdToggle): ResponsiveColumn<T> => ({
  id: "early-bird",
  header: "Early bird",
  cell: (registration) => <EarlyBirdSwitch registration={registration} toggle={toggle} />,
});

/** The server's amounts (dollars), added up to the cent. */
const totalCents = (amounts: readonly number[]) => amounts.reduce((sum, amount) => sum + toCents(amount), 0);

function Total({ label, cents, players, note }: { label: string; cents: number; players: number; note: string }) {
  return (
    <div className="mt-4 flex items-center justify-between rounded-lg bg-muted p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{formatMoney(cents, { forceCents: true })}</p>
      </div>
      <div className="text-right">
        <p className="text-sm text-muted-foreground">{plural(players, "player")}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}

interface PendingPaymentsProps {
  query: UseQueryResult<PendingRegistrationDto[]>;
  timeZone: string;
  /** The registration being confirmed: only its own button waits for the server. */
  confirmingIds: ReadonlySet<string>;
  onConfirm: (registrationId: string) => void;
  earlyBirds: EarlyBirdToggle;
  /**
   * Why nobody more can be accepted now ("18 of 18 players accepted: raise Max players to accept
   * more", shared/domain/waiting-list), said over the waiting list; null while there is room.
   */
  full?: string | null;
}

/** The unpaid sign-ups in the field, and those on the waiting list behind it (round 5, item 15), next in first. */
function splitPending(rows: readonly PendingRegistrationDto[]): { field: PendingRegistrationDto[]; waiting: Array<PendingRegistrationDto & { place: number }> } {
  const field: PendingRegistrationDto[] = [];
  const waiting: Array<PendingRegistrationDto & { place: number }> = [];
  for (const row of rows) {
    const place = waitingListPlaceOf(row);
    if (place === null) field.push(row);
    else waiting.push({ ...row, place });
  }
  return { field, waiting: waiting.sort((a, b) => a.place - b.place) };
}

/**
 * Sign-ups waiting at the desk: what each owes (every buy-in, re-buy, add-on and the high hand), and
 * Confirm. Under them, numbered, the waiting list behind a full field (round 5, item 15): confirming
 * one's payment accepts them, which the server refuses while Max players are accepted, so the list
 * says so first. Their amounts are not in the total: they pay once a place opens.
 */
export function PendingPayments({ query, timeZone, confirmingIds, onConfirm, earlyBirds, full = null }: PendingPaymentsProps) {
  const waitingListHeading = useId();
  const confirmButton = (registration: PendingRegistrationDto) => (
    <Button
      className="h-11 md:h-10"
      onClick={() => onConfirm(registration.id)}
      busy={confirmingIds.has(registration.id)}
      aria-label={`Confirm payment for ${playerName(registration)}`}
      data-testid={`confirm-payment-${registration.id}`}
    >
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      Confirm Payment
    </Button>
  );
  const player: ResponsiveColumn<PendingRegistrationDto> = { id: "player", header: "Player", phone: "title", className: "font-medium", cell: playerName };
  const phone: ResponsiveColumn<PendingRegistrationDto> = { id: "phone", header: "Phone", className: "text-muted-foreground", cell: phoneOf };
  const amount: ResponsiveColumn<PendingRegistrationDto> = {
    id: "amount",
    header: "Amount",
    className: "text-lg font-semibold tabular-nums",
    cell: (registration) => formatMoney(toCents(registration.amountOwed), { forceCents: true }),
  };
  const time: ResponsiveColumn<PendingRegistrationDto> = {
    id: "time",
    header: "Time",
    className: "text-sm text-muted-foreground",
    cell: (registration) => formatTime(registration.registrationTime, timeZone),
  };
  const action: ResponsiveColumn<PendingRegistrationDto> = { id: "action", header: "Action", className: "text-right", phone: "actions", cell: confirmButton };
  const columns: ResponsiveColumn<PendingRegistrationDto>[] = [
    player,
    phone,
    { id: "high-hands", header: "High Hands", cell: (registration) => <HighHands entering={registration.enteringHighHands} /> },
    amount,
    time,
    earlyBirdColumn(earlyBirds),
    action,
  ];
  const waitingColumns: ResponsiveColumn<PendingRegistrationDto & { place: number }>[] = [
    {
      id: "place",
      header: "No.",
      phone: "title",
      className: "font-bold tabular-nums text-muted-foreground",
      cell: (registration) => (
        <>
          <span aria-hidden="true">#{registration.place}</span>
          <span className="sr-only">Number {registration.place}</span>
        </>
      ),
    },
    player,
    phone,
    amount,
    time,
    action,
  ];

  return (
    <QueryState
      query={query}
      loading={<LoadingRows rows={3} />}
      errorTitle="The pending registrations could not be loaded"
      empty={
        <EmptyState
          icon={<Clock className="h-8 w-8" />}
          title="No pending registrations"
          description="New registrations will appear here automatically"
        />
      }
    >
      {(rows) => {
        const { field, waiting } = splitPending(rows);
        return (
          <>
            {field.length > 0 ? (
              <>
                <ResponsiveTable
                  rows={field}
                  columns={columns}
                  rowKey={(registration) => registration.id}
                  rowProps={(registration) => ({ "data-testid": `registration-${registration.id}` })}
                  caption="Registrations waiting for payment"
                />
                <Total label="Total Pending" cents={totalCents(field.map((row) => row.amountOwed))} players={field.length} note="awaiting confirmation" />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Everyone in the field has paid.</p>
            )}
            {waiting.length > 0 ? (
              <section aria-labelledby={waitingListHeading} className="mt-6 space-y-3" data-testid="payment-waiting-list">
                <h3 id={waitingListHeading} className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Hourglass className="h-4 w-4 text-accent-text" aria-hidden="true" />
                  Waiting list · {waiting.length}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Signed up after the field filled, in order. Confirming a payment accepts the player: take the next one&apos;s when a place opens.
                </p>
                {full ? (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" data-testid="payment-waiting-full">
                    {full}.
                  </p>
                ) : null}
                <ResponsiveTable
                  rows={waiting}
                  columns={waitingColumns}
                  rowKey={(registration) => registration.id}
                  rowProps={(registration) => ({ "data-testid": `registration-${registration.id}` })}
                  caption="Waiting list"
                  titleLevel={4}
                />
              </section>
            ) : null}
          </>
        );
      }}
    </QueryState>
  );
}

interface ConfirmedPaymentsProps {
  query: UseQueryResult<ConfirmedRegistrationDto[]>;
  timeZone: string;
  earlyBirds: EarlyBirdToggle;
}

/** Players who have paid: what each paid, by the same formula as what they owed. */
export function ConfirmedPayments({ query, timeZone, earlyBirds }: ConfirmedPaymentsProps) {
  const columns: ResponsiveColumn<ConfirmedRegistrationDto>[] = [
    {
      id: "player",
      header: "Player",
      phone: "title",
      className: "font-medium",
      cell: playerName,
    },
    { id: "phone", header: "Phone", className: "text-muted-foreground", cell: phoneOf },
    { id: "high-hands", header: "High Hands", cell: (registration) => <HighHands entering={registration.enteringHighHands} /> },
    {
      id: "amount",
      header: "Amount Paid",
      className: "text-lg font-semibold tabular-nums",
      cell: (registration) => formatMoney(toCents(registration.amountPaid), { forceCents: true }),
    },
    {
      id: "time",
      header: "Registered At",
      className: "text-sm text-muted-foreground",
      cell: (registration) => formatTime(registration.registrationTime, timeZone),
    },
    earlyBirdColumn(earlyBirds),
    {
      id: "status",
      header: "Status",
      className: "text-right",
      cell: () => (
        <Badge className="bg-status-live text-status-live-foreground hover:bg-status-live">
          <Check className="mr-1 h-3 w-3" aria-hidden="true" />
          Confirmed
        </Badge>
      ),
    },
  ];

  return (
    <QueryState
      query={query}
      loading={<LoadingRows rows={3} />}
      errorTitle="The confirmed players could not be loaded"
      empty={
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8" />}
          title="No confirmed players yet"
          description="Confirmed players will appear here"
        />
      }
    >
      {(rows) => (
        <>
          <ResponsiveTable
            rows={rows}
            columns={columns}
            rowKey={(registration) => registration.id}
            rowProps={(registration) => ({ "data-testid": `confirmed-registration-${registration.id}` })}
            caption="Players who have paid"
          />
          <Total label="Total Collected" cents={totalCents(rows.map((row) => row.amountPaid))} players={rows.length} note="confirmed and paid" />
        </>
      )}
    </QueryState>
  );
}

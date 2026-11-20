import { useId, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Banknote, Check, CheckCircle2, Clock, Hourglass, Landmark, Ticket, Trophy, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { formatMoney, formatTime, plural } from "@/lib/format";
import { normaliseName } from "@shared/api/players";
import {
  PAID_BY_LABELS,
  paymentReference,
  type ConfirmedRegistrationDto,
  type PaymentMethod,
  type PendingRegistrationDto,
  type StaffRegistrationDto,
} from "@shared/api/registrations";
import { highHandsAtDoor, highHandsOf, type HighHandsInput } from "@shared/domain/high-hands";
import { isFreeEntry } from "@shared/domain/prize-pool";
import { toCents, type Cents } from "@shared/domain/money";
import { waitingListPlaceOf } from "@/features/public-tournament/waiting-list";
import { playerName } from "../../player-name";
import type { EntryFixes } from "../entry-fix/use-entry-fixes";
import { FreeEntryBadge } from "../free-entry/free-entry-badge";
import { doorSentence, transferSplit, type TransferDesk, type TransferSplit } from "./transfer-split";

/** A phone number for the player's own club; another club's player keeps theirs (ClubPlayer.canEdit). */
const phoneOf = (registration: StaffRegistrationDto) =>
  registration.player?.canEdit === false ? "Other club" : registration.player?.phone || "N/A";

/**
 * Whether the entry is in the high hand; in a game with several (round 10), the ones it chose, each a
 * badge ("First half").
 */
function HighHands({ registration, tournament }: { registration: StaffRegistrationDto; tournament?: HighHandsInput }) {
  if (tournament && highHandsOf(tournament).length > 1) {
    const chosen = highHandsAtDoor(tournament, registration);
    return (
      <span className="flex flex-wrap gap-1" data-testid={`high-hands-${registration.id}`}>
        {chosen.length === 0 ? (
          <Badge variant="outline">No</Badge>
        ) : (
          chosen.map((highHand) => (
            <Badge key={highHand.highHandId} variant="secondary">
              <Trophy className="mr-1 h-3 w-3" aria-hidden="true" />
              {highHand.name}
            </Badge>
          ))
        )}
      </span>
    );
  }
  return registration.enteringHighHands ? (
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

/** Under the total collected: "confirmed and paid", or how many of them came in free. */
function freeEntryNote(rows: readonly ConfirmedRegistrationDto[], freeTournament: boolean): string {
  if (freeTournament) return "accepted";
  const free = rows.filter(isFreeEntry).length;
  return free > 0 ? `confirmed · ${free} free ${free === 1 ? "entry" : "entries"}` : "confirmed and paid";
}

const money = (cents: Cents) => formatMoney(cents, { forceCents: true });

/**
 * An entry's amount and, where its player was told to transfer the buy-in only (round 8), the two parts
 * under it: what the transfer pays and what is still paid at the door (the high hand), so the TD
 * matches the bank line to the buy-in and knows what else to collect.
 */
function SplitAmount({ id, amount, split }: { id: string; amount: number; split: TransferSplit | null }) {
  if (!split || split.doorCents === 0) return <>{money(toCents(amount))}</>;
  return (
    <span className="inline-block">
      <span className="block">{money(toCents(amount))}</span>
      <span className="block text-xs font-normal text-muted-foreground" data-testid={`transfer-part-${id}`}>
        Transfer {money(split.transferCents)} ({split.transferFor})
      </span>
      <span className="block text-xs font-medium text-foreground" data-testid={`door-part-${id}`}>
        At the door {money(split.doorCents)}
        {split.doorFor ? ` (${split.doorFor})` : ""}
      </span>
    </span>
  );
}

/** The server's amounts (dollars), added up to the cent. */
const totalCents = (amounts: readonly number[]) => amounts.reduce((sum, amount) => sum + toCents(amount), 0);

function Total({ label, cents, players, note }: { label: string; cents: number; players: number; note: string }) {
  return (
    <div className="mt-4 flex items-center justify-between rounded-lg bg-muted p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{money(cents)}</p>
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
  /** Confirms the payment, and how it was paid when the desk asked (`transfers`). */
  onConfirm: (registrationId: string, paidBy?: PaymentMethod) => void;
  /**
   * Opens the free-entry sheet for a sign-up (round 7, item 6): "Free entry" beside Confirm Payment.
   * Left out where nobody pays a buy-in (`freeTournament`).
   */
  onFreeEntry?: (registration: PendingRegistrationDto) => void;
  /**
   * The game has no buy-in (round 7, item 8): nobody pays to play, so each sign-up is accepted
   * ("Accept"), which confirms it at $0 (or at what its high hand costs).
   */
  freeTournament?: boolean;
  earlyBirds: EarlyBirdToggle;
  /**
   * Why nobody more can be accepted now ("18 of 18 players accepted: raise Max players to accept
   * more", shared/domain/waiting-list), said over the waiting list; null while there is room.
   */
  full?: string | null;
  /**
   * The tournament shows bank transfer details after sign-up (round 8; null: it does not): each unpaid
   * sign-up shows the Reference their transfer carries (their name, cut to 12 characters) and, when
   * part of what they owe is paid at the door (the high hand), the two parts; a box finds a name or
   * reference from the bank statement, and the payment is confirmed as Cash or Transfer for the club's
   * records. Transfer asks first while something is still to collect at the door.
   */
  transfers?: TransferDesk | null;
  /** The tournament, for the high hands each player chose (round 10: a game may run several). */
  tournament?: HighHandsInput;
}

/** Whether the registration's player is the one a bank statement's name or reference points to. */
const matches = (registration: StaffRegistrationDto, search: string) => normaliseName(playerName(registration)).includes(search);

function TransferSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Find a transfer</Label>
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Name or reference from the bank"
        autoComplete="off"
        className="h-11 md:h-10"
        data-testid="transfer-search"
      />
    </div>
  );
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
 * Before a transfer is confirmed for an entry that owes more than its buy-in (round 8): the transfer
 * paid the buy-in only, and confirming takes the whole entry, the high hand into its pot included, so
 * the TD collects the rest at the door first. "Not yet" leaves the entry on the list to pay.
 */
function CollectAtDoorDialog({
  registration,
  split,
  onOpenChange,
  onConfirm,
}: {
  registration: PendingRegistrationDto | null;
  split: TransferSplit | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (registrationId: string) => void;
}) {
  const shown = registration && split ? { registration, split } : null;
  return (
    <ConfirmDialog
      open={shown !== null}
      onOpenChange={onOpenChange}
      title={shown ? `Collect ${money(shown.split.doorCents)} at the door` : ""}
      description={
        shown
          ? `${playerName(shown.registration)}'s bank transfer pays the ${shown.split.transferFor}, ${money(shown.split.transferCents)}. ${doorSentence(shown.split)}`
          : ""
      }
      cancelLabel="Not yet"
      confirmLabel="Collected: confirm"
      contentTestId="collect-at-door"
      confirmTestId="collect-at-door-confirm"
      onConfirm={() => {
        if (shown) onConfirm(shown.registration.id);
      }}
    />
  );
}

/**
 * Sign-ups waiting at the desk: what each owes (every buy-in, re-buy, add-on and the high hand), and
 * Confirm. Under them, numbered, the waiting list behind a full field (round 5, item 15): confirming
 * one's payment accepts them, which the server refuses while Max players are accepted, so the list
 * says so first. Their amounts are not in the total: they pay once a place opens. Where players may
 * pay ahead by bank transfer (round 8), the field shows each one's transfer Reference and what of their
 * amount the transfer pays and the door collects, a box narrows both lists to the name on a transfer,
 * and Confirm is Cash or Transfer.
 */
export function PendingPayments({
  query,
  timeZone,
  confirmingIds,
  onConfirm,
  onFreeEntry,
  freeTournament = false,
  earlyBirds,
  full = null,
  transfers = null,
  tournament,
}: PendingPaymentsProps) {
  const waitingListHeading = useId();
  const [search, setSearch] = useState("");
  // The entry whose transfer is being confirmed while the high hand is still to collect at the door.
  const [collecting, setCollecting] = useState<PendingRegistrationDto | null>(null);
  const byTransfer = transfers && !freeTournament ? transfers : null;
  const found = normaliseName(search);
  const splitOf = (registration: PendingRegistrationDto) => (byTransfer ? transferSplit(registration, registration.amountOwed, byTransfer, tournament) : null);
  const confirmTransfer = (registration: PendingRegistrationDto) => {
    if ((splitOf(registration)?.doorCents ?? 0) > 0) setCollecting(registration);
    else onConfirm(registration.id, "transfer");
  };
  const confirmButtons = (registration: PendingRegistrationDto) =>
    byTransfer ? (
      // Cash and Transfer wrap together on a phone, never one without the other.
      <div className="flex gap-2">
        <Button
          className="h-11 md:h-10"
          onClick={() => onConfirm(registration.id, "cash")}
          busy={confirmingIds.has(registration.id)}
          aria-label={`Confirm cash payment for ${playerName(registration)}`}
          data-testid={`confirm-payment-${registration.id}`}
        >
          <Banknote className="h-4 w-4" aria-hidden="true" />
          Cash
        </Button>
        <Button
          className="h-11 md:h-10"
          onClick={() => confirmTransfer(registration)}
          busy={confirmingIds.has(registration.id)}
          aria-label={`Confirm bank transfer for ${playerName(registration)}`}
          data-testid={`confirm-transfer-${registration.id}`}
        >
          <Landmark className="h-4 w-4" aria-hidden="true" />
          Transfer
        </Button>
      </div>
    ) : (
      <Button
        className="h-11 md:h-10"
        onClick={() => onConfirm(registration.id)}
        busy={confirmingIds.has(registration.id)}
        aria-label={freeTournament ? `Accept ${playerName(registration)}` : `Confirm payment for ${playerName(registration)}`}
        data-testid={`confirm-payment-${registration.id}`}
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {freeTournament ? "Accept" : "Confirm Payment"}
      </Button>
    );
  const confirmButton = (registration: PendingRegistrationDto) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {onFreeEntry && !freeTournament ? (
        <Button
          variant="outline"
          className="h-11 md:h-10"
          // Not while its payment is being confirmed: one answer at a time for a row.
          onClick={() => {
            if (!confirmingIds.has(registration.id)) onFreeEntry(registration);
          }}
          aria-disabled={confirmingIds.has(registration.id) || undefined}
          aria-label={`Free entry for ${playerName(registration)}`}
          data-testid={`free-entry-${registration.id}`}
        >
          <Ticket className="h-4 w-4" aria-hidden="true" />
          Free entry
        </Button>
      ) : null}
      {confirmButtons(registration)}
    </div>
  );
  const player: ResponsiveColumn<PendingRegistrationDto> = { id: "player", header: "Player", phone: "title", className: "font-medium", cell: playerName };
  const phone: ResponsiveColumn<PendingRegistrationDto> = { id: "phone", header: "Phone", className: "text-muted-foreground", cell: phoneOf };
  const amount: ResponsiveColumn<PendingRegistrationDto> = {
    id: "amount",
    header: "Amount",
    className: "text-lg font-semibold tabular-nums",
    cell: (registration) => <SplitAmount id={registration.id} amount={registration.amountOwed} split={splitOf(registration)} />,
  };
  const time: ResponsiveColumn<PendingRegistrationDto> = {
    id: "time",
    header: "Time",
    className: "text-sm text-muted-foreground",
    cell: (registration) => formatTime(registration.registrationTime, timeZone),
  };
  const action: ResponsiveColumn<PendingRegistrationDto> = { id: "action", header: "Action", className: "text-right", phone: "actions", cell: confirmButton };
  const reference: ResponsiveColumn<PendingRegistrationDto> = {
    id: "reference",
    header: "Transfer ref",
    className: "text-muted-foreground",
    cell: (registration) => <span data-testid={`transfer-reference-${registration.id}`}>{paymentReference(playerName(registration))}</span>,
  };
  const columns: ResponsiveColumn<PendingRegistrationDto>[] = [
    player,
    ...(byTransfer ? [reference] : []),
    phone,
    { id: "high-hands", header: "High Hands", cell: (registration) => <HighHands registration={registration} tournament={tournament} /> },
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
        // A bank statement's name or reference narrows both lists; the total stays the whole field's.
        const shownField = byTransfer && found ? field.filter((row) => matches(row, found)) : field;
        const shownWaiting = byTransfer && found ? waiting.filter((row) => matches(row, found)) : waiting;
        return (
          <>
            {byTransfer ? <TransferSearch value={search} onChange={setSearch} /> : null}
            {byTransfer && found && shownField.length + shownWaiting.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="transfer-search-none">
                Nobody waiting to pay matches &ldquo;{search.trim()}&rdquo;.
              </p>
            ) : null}
            {field.length > 0 ? (
              <>
                {shownField.length > 0 ? (
                  <ResponsiveTable
                    rows={shownField}
                    columns={columns}
                    rowKey={(registration) => registration.id}
                    rowProps={(registration) => ({ "data-testid": `registration-${registration.id}` })}
                    caption="Registrations waiting for payment"
                  />
                ) : null}
                <Total
                  label={freeTournament ? "Still to pay" : "Total Pending"}
                  cents={totalCents(field.map((row) => row.amountOwed))}
                  players={field.length}
                  note={freeTournament ? "waiting to be accepted" : "awaiting confirmation"}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{freeTournament ? "Everyone in the field has been accepted." : "Everyone in the field has paid."}</p>
            )}
            {shownWaiting.length > 0 ? (
              <section aria-labelledby={waitingListHeading} className="mt-6 space-y-3" data-testid="payment-waiting-list">
                <h3 id={waitingListHeading} className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Hourglass className="h-4 w-4 text-accent-text" aria-hidden="true" />
                  Waiting list · {waiting.length}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {freeTournament
                    ? "Signed up after the field filled, in order. Accept the next one when a place opens."
                    : "Signed up after the field filled, in order. Confirming a payment accepts the player: take the next one's when a place opens."}
                </p>
                {full ? (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" data-testid="payment-waiting-full">
                    {full}.
                  </p>
                ) : null}
                <ResponsiveTable
                  rows={shownWaiting}
                  columns={waitingColumns}
                  rowKey={(registration) => registration.id}
                  rowProps={(registration) => ({ "data-testid": `registration-${registration.id}` })}
                  caption="Waiting list"
                  titleLevel={4}
                />
              </section>
            ) : null}
            <CollectAtDoorDialog
              registration={collecting}
              split={collecting ? splitOf(collecting) : null}
              onOpenChange={(open) => {
                if (!open) setCollecting(null);
              }}
              onConfirm={(registrationId) => onConfirm(registrationId, "transfer")}
            />
          </>
        );
      }}
    </QueryState>
  );
}

/** A free entry's other way out (round 7): back to a normal unpaid entry, or paid after all. */
export type FreeEntryUndo = "take_back" | "mark_paid";

/** What the confirmed list does with a free entry (round 7, item 6). */
export interface FreeEntryActions {
  /** The registrations whose change is being saved: their buttons wait for the server. */
  busy: ReadonlySet<string>;
  onChange: (registration: ConfirmedRegistrationDto, change: FreeEntryUndo) => void;
}

/** How a confirmed payment was made, when the TD said (round 8): cash or bank transfer. */
function PaidByMark({ registration }: { registration: ConfirmedRegistrationDto }) {
  const paidBy = registration.paidBy;
  if (paidBy !== "cash" && paidBy !== "transfer") return null;
  return (
    <Badge variant="outline" data-testid={`paid-by-${registration.id}`}>
      {paidBy === "transfer" ? <Landmark className="mr-1 h-3 w-3" aria-hidden="true" /> : <Banknote className="mr-1 h-3 w-3" aria-hidden="true" />}
      {PAID_BY_LABELS[paidBy]}
    </Badge>
  );
}

/** A free entry's FREE mark, and its way back: Mark paid, or Undo (a normal unpaid entry again). */
function FreeEntryStatusCell({ registration, actions }: { registration: ConfirmedRegistrationDto; actions?: FreeEntryActions }) {
  const name = playerName(registration);
  const busy = actions?.busy.has(registration.id) ?? false;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <FreeEntryBadge entry={registration} />
      {actions ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            busy={busy}
            onClick={() => actions.onChange(registration, "mark_paid")}
            aria-label={`Mark ${name} paid`}
            data-testid={`free-entry-paid-${registration.id}`}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Mark paid
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 md:h-9"
            busy={busy}
            onClick={() => actions.onChange(registration, "take_back")}
            aria-label={`Undo ${name}'s free entry`}
            data-testid={`free-entry-undo-${registration.id}`}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Undo
          </Button>
        </>
      ) : null}
    </div>
  );
}

interface ConfirmedPaymentsProps {
  query: UseQueryResult<ConfirmedRegistrationDto[]>;
  timeZone: string;
  earlyBirds: EarlyBirdToggle;
  /** Mark paid and Undo for a free entry; left out, its FREE mark is shown alone. */
  freeEntries?: FreeEntryActions;
  /** The game has no buy-in (round 7, item 8): the players were accepted, not paid. */
  freeTournament?: boolean;
  /** Players may pay ahead by bank transfer (round 8): a payment confirmed as a transfer shows what the door collected. */
  transfers?: TransferDesk | null;
  /** The ⋯ Fix menu on every row (round 9): a payment taken back, how it was paid, the high hand, the player's details. */
  fixes?: Pick<EntryFixes, "menu">;
  /** The tournament, for the high hands each player chose (round 10). */
  tournament?: HighHandsInput;
}

/**
 * Players who have paid, or were let in free (round 7: FREE, with Mark paid and Undo): what each paid,
 * by the same formula as what they owed (a free entry's buy-in is not paid). A payment confirmed as a
 * bank transfer (round 8) shows what the transfer paid and what was collected at the door. Each row's
 * Fix menu (round 9) corrects a mistake: a payment confirmed that was not made, how it was made, the
 * high hand, the player's details.
 */
export function ConfirmedPayments({ query, timeZone, earlyBirds, freeEntries, freeTournament = false, transfers = null, fixes, tournament }: ConfirmedPaymentsProps) {
  const splitOf = (registration: ConfirmedRegistrationDto) =>
    transfers && registration.paidBy === "transfer" ? transferSplit(registration, registration.amountPaid, transfers, tournament) : null;
  const columns: ResponsiveColumn<ConfirmedRegistrationDto>[] = [
    {
      id: "player",
      header: "Player",
      phone: "title",
      className: "font-medium",
      cell: playerName,
    },
    { id: "phone", header: "Phone", className: "text-muted-foreground", cell: phoneOf },
    { id: "high-hands", header: "High Hands", cell: (registration) => <HighHands registration={registration} tournament={tournament} /> },
    {
      id: "amount",
      header: "Amount Paid",
      className: "text-lg font-semibold tabular-nums",
      cell: (registration) => <SplitAmount id={registration.id} amount={registration.amountPaid} split={splitOf(registration)} />,
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
      phone: "actions",
      cell: (registration) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isFreeEntry(registration) ? (
            <FreeEntryStatusCell registration={registration} actions={freeEntries} />
          ) : (
            <>
              <PaidByMark registration={registration} />
              <Badge className="bg-status-live text-status-live-foreground hover:bg-status-live">
                <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                {freeTournament ? "Accepted" : "Confirmed"}
              </Badge>
            </>
          )}
          {fixes?.menu(registration)}
        </div>
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
          title={freeTournament ? "Nobody accepted yet" : "No confirmed players yet"}
          description={freeTournament ? "Accepted players will appear here" : "Confirmed players will appear here"}
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
            caption={freeTournament ? "Players accepted" : "Players who have paid"}
          />
          <Total
            label="Total Collected"
            cents={totalCents(rows.map((row) => row.amountPaid))}
            players={rows.length}
            note={freeEntryNote(rows, freeTournament)}
          />
        </>
      )}
    </QueryState>
  );
}

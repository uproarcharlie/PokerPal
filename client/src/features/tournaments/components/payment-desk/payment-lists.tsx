import type { UseQueryResult } from "@tanstack/react-query";
import { Check, CheckCircle2, Clock, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { formatMoney, formatTime, plural } from "@/lib/format";
import type { ConfirmedRegistrationDto, PendingRegistrationDto, StaffRegistrationDto } from "@shared/api/registrations";
import { toCents } from "@shared/domain/money";
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
}

/** Sign-ups waiting at the desk: what each owes (every buy-in, re-buy, add-on and the high hand), and Confirm. */
export function PendingPayments({ query, timeZone, confirmingIds, onConfirm }: PendingPaymentsProps) {
  const columns: ResponsiveColumn<PendingRegistrationDto>[] = [
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
      header: "Amount",
      className: "text-lg font-semibold tabular-nums",
      cell: (registration) => formatMoney(toCents(registration.amountOwed), { forceCents: true }),
    },
    { id: "time", header: "Time", className: "text-sm text-muted-foreground", cell: (registration) => formatTime(registration.registrationTime, timeZone) },
    {
      id: "action",
      header: "Action",
      className: "text-right",
      phone: "actions",
      cell: (registration) => (
        <Button onClick={() => onConfirm(registration.id)} busy={confirmingIds.has(registration.id)} data-testid={`confirm-payment-${registration.id}`}>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Confirm Payment
        </Button>
      ),
    },
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
      {(rows) => (
        <>
          <ResponsiveTable
            rows={rows}
            columns={columns}
            rowKey={(registration) => registration.id}
            rowProps={(registration) => ({ "data-testid": `registration-${registration.id}` })}
            caption="Registrations waiting for payment"
          />
          <Total label="Total Pending" cents={totalCents(rows.map((row) => row.amountOwed))} players={rows.length} note="awaiting confirmation" />
        </>
      )}
    </QueryState>
  );
}

/** Players who have paid: what each paid, by the same formula as what they owed. */
export function ConfirmedPayments({ query, timeZone }: { query: UseQueryResult<ConfirmedRegistrationDto[]>; timeZone: string }) {
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

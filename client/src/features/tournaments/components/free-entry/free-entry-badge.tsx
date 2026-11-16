import { Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { FREE_ENTRY_REASON_LABELS, type FreeEntryStatus } from "@shared/api/registrations";

/**
 * The free entry a registration carries as the club's staff are sent it (round 7), or null: a public
 * row never carries one, and an entry that is not free says so.
 */
export const freeEntryOf = (registration: { id: string } & Partial<FreeEntryStatus>): FreeEntryStatus | null =>
  registration.freeEntry === true ? (registration as FreeEntryStatus) : null;

/** The free entries among registrations as the club's staff are sent them, by registration id (the seats' FREE marks). */
export function freeEntriesById(registrations: readonly ({ id: string } & Partial<FreeEntryStatus>)[]): ReadonlyMap<string, FreeEntryStatus> {
  const free = new Map<string, FreeEntryStatus>();
  for (const registration of registrations) {
    const entry = freeEntryOf(registration);
    if (entry) free.set(registration.id, entry);
  }
  return free;
}

/** Why the entry is free, in a few words: "Season prize", "Other: birthday", and "club pays the buy-in" when funded. */
export function freeEntryDetail(entry: FreeEntryStatus): string {
  const reason = entry.freeEntryReason ? FREE_ENTRY_REASON_LABELS[entry.freeEntryReason] : FREE_ENTRY_REASON_LABELS.other;
  const note = entry.freeEntryNote?.trim();
  return [note ? `${reason}: ${note}` : reason, ...(entry.freeEntryFunded ? ["club pays the buy-in"] : [])].join(" · ");
}

/**
 * The FREE mark on a player the club let in free (round 7, item 6), on the staff's screens only (the
 * players list, the payment desk, the seats): public screens are never sent who has one. Its words for
 * a screen reader say why ("free entry: Season prize").
 */
export function FreeEntryBadge({ entry, className }: { entry: FreeEntryStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-status-registration px-2 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-wide text-status-registration-foreground",
        className,
      )}
      title={freeEntryDetail(entry)}
      data-testid="free-entry-badge"
    >
      <Ticket className="h-3 w-3" aria-hidden="true" />
      <span aria-hidden="true">Free</span>
      <span className="sr-only">Free entry: {freeEntryDetail(entry)}</span>
    </span>
  );
}

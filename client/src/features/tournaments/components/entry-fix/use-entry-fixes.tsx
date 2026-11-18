import { useState, type ReactNode, type RefObject } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import type { PaymentMethod } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isFreeTournament, paymentDropCents, type EntryInput } from "@shared/domain/prize-pool";
import { playerName } from "../../player-name";
import { useConfirmPayment, useUpdateRegistration } from "../../staff-hooks";
import { EntryFixMenu } from "./entry-fix-menu";
import { entryFixOptions, notPaidQuestion, type FixableEntry } from "./entry-fixes";
import { EntryPlayerSheet } from "./entry-player-sheet";

interface EntryFixContext {
  tournament: TournamentDetailDto;
  /**
   * Every registration with its payment status (the desk's two lists, or the registrations as the
   * club's staff are sent them), for what a payment taken back takes out of the pool; undefined while
   * they are on their way.
   */
  registrations: readonly (EntryInput & { id: string })[] | undefined;
  /** Where focus goes when the corrected row has left the list (a payment taken back moves it to the list to pay). */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** The menu button's test id is `<prefix>-<registration id>`: the standings use their own, as a desk sheet can be open over them. */
  testIdPrefix?: string;
}

export interface EntryFixes {
  /** The ⋯ Fix menu for one row. */
  menu: (entry: FixableEntry) => ReactNode;
  /** The question before a payment is taken back, and the edit-player sheet: rendered once, beside the list. */
  dialogs: ReactNode;
}

/** Said in the toast once a payment's method is changed. */
const PAID_WORDS: Readonly<Record<PaymentMethod, string>> = { cash: "paid in cash", transfer: "paid by bank transfer" };

/**
 * The Fix menu's corrections for a list of entries (round 9, item 1), wherever the list is (the
 * payment desk, the phone's Take payment sheet, the standings): a payment taken back after the
 * question saying what the prize pool loses, how it was paid, the high hand, and the player's details.
 * Each row waits for its own answer, which is told for its own row; the server writes each correction
 * to the staff's feed and the audit log.
 */
export function useEntryFixes({ tournament, registrations, returnFocusTo, testIdPrefix = "fix-entry" }: EntryFixContext): EntryFixes {
  const { toast } = useToast();
  const update = useUpdateRegistration(tournament.id);
  const confirmPayment = useConfirmPayment(tournament.id);
  const rows = useBusyRows();
  // The entry whose payment is being taken back, and the question as it stood when asked (the answer changes the pool it describes).
  const [unpaying, setUnpaying] = useState<{ entry: FixableEntry; question: string } | null>(null);
  const [editing, setEditing] = useState<FixableEntry | null>(null);
  const freeTournament = isFreeTournament(tournament);

  const correct = async (entry: FixableEntry, request: () => Promise<unknown>, done: { title: string; description: string }, failed: string) => {
    try {
      await rows.run(entry.id, request);
      toast(done);
    } catch (error) {
      toast({ title: failed, description: errorMessage(error), variant: "destructive" });
    }
  };

  const menu = (entry: FixableEntry) => {
    const name = playerName(entry);
    return (
      <EntryFixMenu
        name={name}
        registrationId={entry.id}
        triggerTestId={`${testIdPrefix}-${entry.id}`}
        options={entryFixOptions(entry, tournament)}
        busy={rows.busy.has(entry.id)}
        freeTournament={freeTournament}
        onNotPaid={() => {
          const drop = registrations ? paymentDropCents(tournament, registrations, entry.id) : undefined;
          setUnpaying({ entry, question: notPaidQuestion(name, drop, { freeTournament }) });
        }}
        onPaidBy={(paidBy) =>
          void correct(
            entry,
            () => confirmPayment.mutateAsync({ registrationId: entry.id, paidBy }),
            { title: "Payment updated", description: `${name} ${PAID_WORDS[paidBy]}.` },
            "Could not change how they paid",
          )
        }
        onHighHand={(entered) =>
          void correct(
            entry,
            () => update.mutateAsync({ registrationId: entry.id, input: { enteringHighHands: entered } }),
            { title: "High hand updated", description: entered ? `${name} is now in the high hand.` : `${name} is no longer in the high hand.` },
            "Could not change the high hand",
          )
        }
        onEditPlayer={() => setEditing(entry)}
      />
    );
  };

  const unpayingName = unpaying ? playerName(unpaying.entry) : "";
  const dialogs = (
    <>
      <ConfirmDialog
        open={unpaying !== null}
        onOpenChange={(open) => {
          if (!open) setUnpaying(null);
        }}
        returnFocusTo={returnFocusTo}
        title={unpaying ? `Mark ${unpayingName} as not ${freeTournament ? "accepted" : "paid"}?` : ""}
        description={unpaying?.question ?? ""}
        confirmLabel={freeTournament ? "Mark as not accepted" : "Mark as not paid"}
        pendingLabel="Saving…"
        destructive
        contentTestId="fix-not-paid-dialog"
        confirmTestId="fix-not-paid-confirm"
        onConfirm={async () => {
          if (!unpaying) return;
          const { entry } = unpaying;
          await rows.run(entry.id, () => update.mutateAsync({ registrationId: entry.id, input: { paymentConfirmed: false } }));
          toast({
            title: freeTournament ? "Marked as not accepted" : "Marked as not paid",
            description: `${unpayingName} is back on the list ${freeTournament ? "to accept" : "to pay"}.`,
          });
        }}
      />
      <EntryPlayerSheet tournamentId={tournament.id} entry={editing} onClose={() => setEditing(null)} />
    </>
  );

  return { menu, dialogs };
}

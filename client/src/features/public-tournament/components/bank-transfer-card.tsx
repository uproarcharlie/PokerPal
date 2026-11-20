import { useId, type ReactNode } from "react";
import { Landmark } from "lucide-react";
import type { PaymentInstructionsDto } from "@shared/api/registrations";
import { DEFAULT_HIGH_HAND_NAME, highHandLabel, LEGACY_HIGH_HAND_ID } from "@shared/domain/high-hands";
import { formatMoney, type Cents } from "@/lib/format";
import { CopyValueButton } from "./copy-value-button";

function Detail({ label, children, copy }: { label: string; children: ReactNode; copy?: ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      {/* The Copy button drops below a value too wide to sit beside it, rather than the value breaking. */}
      <dd className="flex min-h-10 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-base font-semibold text-foreground">{children}</span>
        {copy}
      </dd>
    </div>
  );
}

/**
 * "Pay by bank transfer" (round 8, item 3): what the player puts into their banking app to pay the
 * buy-in ahead, each part they type with a Copy button, and that paying at the door still works. The
 * high hands are paid at the door (the owner, 2026-11-16), so each one ticked is only mentioned, with
 * its fee (round 10). The amount includes a bounty game's bounty, which the card names (round 11: the
 * tournament's bountyCents; the answer does not carry it). Shown only to the person who has just signed
 * up (the sign-up's own answer carries the details), with a buy-in to pay.
 */
export function BankTransferCard({ transfer, bountyCents = 0 }: { transfer: PaymentInstructionsDto; bountyCents?: Cents }) {
  const heading = useId();
  const amount = formatMoney(transfer.amountDueCents, { forceCents: true });
  // Each high hand ticked; an answer from before round 10 (a sign-up kept in the tab) says the total.
  const atDoor =
    transfer.highHandsAtDoor ??
    (transfer.highHandAtDoorCents > 0 ? [{ highHandId: LEGACY_HIGH_HAND_ID, name: DEFAULT_HIGH_HAND_NAME, feeCents: transfer.highHandAtDoorCents }] : []);
  return (
    <section aria-labelledby={heading} className="space-y-3 rounded-lg border border-border bg-card p-3 text-left sm:p-4" data-testid="bank-transfer">
      <h2 id={heading} className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Landmark className="h-5 w-5 text-primary" aria-hidden="true" />
        Pay by bank transfer
      </h2>
      <dl className="divide-y divide-border">
        <Detail label="Amount">
          <span className="block text-2xl font-bold tabular-nums text-primary" data-testid="bank-transfer-amount">
            {amount}
          </span>
          {bountyCents > 0 ? (
            <span className="block text-sm font-medium text-muted-foreground" data-testid="bank-transfer-bounty">
              Includes the {formatMoney(bountyCents, { forceCents: true })} bounty
            </span>
          ) : null}
        </Detail>
        <Detail label="Account name">
          <span data-testid="bank-transfer-account-name">{transfer.accountName}</span>
        </Detail>
        <Detail label="Account number" copy={<CopyValueButton value={transfer.accountNumber} what="account number" testId="copy-account-number" />}>
          <span className="whitespace-nowrap tabular-nums" data-testid="bank-transfer-account-number">
            {transfer.accountNumber}
          </span>
        </Detail>
        {transfer.bankName ? (
          <Detail label="Bank">
            <span data-testid="bank-transfer-bank">{transfer.bankName}</span>
          </Detail>
        ) : null}
        <Detail label="Particulars" copy={<CopyValueButton value={transfer.particulars} what="particulars" testId="copy-particulars" />}>
          <span data-testid="bank-transfer-particulars">{transfer.particulars}</span>
        </Detail>
        <Detail label="Reference" copy={<CopyValueButton value={transfer.reference} what="reference" testId="copy-reference" />}>
          <span data-testid="bank-transfer-reference">{transfer.reference}</span>
        </Detail>
      </dl>
      {transfer.instructions ? (
        <p className="whitespace-pre-line text-sm text-foreground" data-testid="bank-transfer-instructions">
          {transfer.instructions}
        </p>
      ) : null}
      {atDoor.length > 0 ? (
        <ul role="list" className="space-y-1">
          {atDoor.map((highHand) => (
            <li key={highHand.highHandId} className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" data-testid="bank-transfer-high-hand">
              {highHandLabel(highHand.name)} ({formatMoney(highHand.feeCents, { forceCents: true })}) — pay at the door
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Or pay at the door.</p>
        <p>The TD will confirm your payment.</p>
      </div>
    </section>
  );
}

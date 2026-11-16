import { useId, type ReactNode } from "react";
import { Landmark } from "lucide-react";
import type { PaymentInstructionsDto } from "@shared/api/registrations";
import { formatMoney } from "@/lib/format";
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
 * high-hand entry is paid at the door (the owner, 2026-11-16), so it is only mentioned. Shown only to
 * the person who has just signed up (the sign-up's own answer carries the details), with a buy-in to pay.
 */
export function BankTransferCard({ transfer }: { transfer: PaymentInstructionsDto }) {
  const heading = useId();
  const amount = formatMoney(transfer.amountDueCents, { forceCents: true });
  return (
    <section aria-labelledby={heading} className="space-y-3 rounded-lg border border-border bg-card p-3 text-left sm:p-4" data-testid="bank-transfer">
      <h2 id={heading} className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Landmark className="h-5 w-5 text-primary" aria-hidden="true" />
        Pay by bank transfer
      </h2>
      <dl className="divide-y divide-border">
        <Detail label="Amount">
          <span className="text-2xl font-bold tabular-nums text-primary" data-testid="bank-transfer-amount">
            {amount}
          </span>
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
      {transfer.highHandAtDoorCents > 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" data-testid="bank-transfer-high-hand">
          High hand ({formatMoney(transfer.highHandAtDoorCents, { forceCents: true })}) — pay at the door
        </p>
      ) : null}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Or pay at the door.</p>
        <p>The TD will confirm your payment.</p>
      </div>
    </section>
  );
}

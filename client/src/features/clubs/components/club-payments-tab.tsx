import { useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Check, Landmark, Trash2 } from "lucide-react";
import { BANK_DETAILS_LIMITS, bankDetailsSchema, type BankDetails, type BankDetailsChangeDto, type ClubPaymentsDto } from "@shared/api/clubs";
import type { ClubDto } from "@shared/api/public";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { clubTimeZone, formatDateTime } from "@/lib/format";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { formatBankAccountInput } from "../bank-account";
import { bankDetailsValues, type BankDetailsValues } from "../club-form";
import { useClubPayments, useUpdateClubPayments } from "../staff-hooks";

const FIELDS = ["accountName", "accountNumber", "bankName", "instructions"] as const;

/** The server names a refused box by its place in the request ("bankDetails.accountNumber"). */
const fieldName = (name: string) => name.replace(/^bankDetails\./, "");

const FIELD_WORDS: Readonly<Record<keyof BankDetails, string>> = {
  accountName: "account name",
  accountNumber: "account number",
  bankName: "bank",
  instructions: "note for players",
};

/** "the account number", "the account name and number"-style lists: "a, b and c". */
function listOf(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Sam Manager changed the account number", "added the bank details", "removed the bank details". */
function changeText({ by, change, fields }: BankDetailsChangeDto): string {
  const who = by ?? "A former staff member";
  if (change === "added") return `${who} added the bank details`;
  if (change === "removed") return `${who} removed the bank details`;
  return `${who} changed the ${listOf(fields.map((field) => FIELD_WORDS[field]))}`;
}

/**
 * Who last changed the bank details, and when, with the changes before (R8REV0-PRIV-03): any of the
 * club's staff may change them, and a new account number sends every later transfer there, so the
 * owner can see it was done and by whom.
 */
function BankDetailsChanges({ changes, timeZone }: { changes: readonly BankDetailsChangeDto[]; timeZone: string }) {
  const heading = useId();
  const [last] = changes;
  if (!last) return null;
  return (
    <section aria-labelledby={heading} className="space-y-2 rounded-md border border-border p-3 text-sm" data-testid="bank-details-changes">
      <h3 id={heading} className="font-medium text-foreground" data-testid="bank-details-last-change">
        Last changed by {last.by ?? "a former staff member"} on {formatDateTime(last.at, timeZone)}
      </h3>
      <ul role="list" className="space-y-1 text-muted-foreground">
        {changes.map((change, index) => (
          <li key={`${change.at}-${index}`}>
            <span className="tabular-nums">{formatDateTime(change.at, timeZone)}</span> · {changeText(change)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BankDetailsForm({ club, payments }: { club: ClubDto; payments: ClubPaymentsDto }) {
  const { toast } = useToast();
  const save = useUpdateClubPayments(club.id);
  const [removing, setRemoving] = useState(false);
  // Focus goes back to Remove when the dialog is cancelled, and to Save once Remove has gone with the details.
  const returnFocus = useRef<HTMLElement | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const form = useForm<BankDetailsValues>({ resolver: formResolver(bankDetailsSchema), defaultValues: bankDetailsValues(payments.bankDetails) });
  const saved = payments.bankDetails !== null;

  const onSubmit = form.handleSubmit(async (values) => {
    let answer: ClubPaymentsDto;
    try {
      answer = await save.mutateAsync({ bankDetails: bankDetailsSchema.parse(values) });
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: FIELDS, rename: fieldName })) {
        toast({ title: "Could not save the bank details", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    form.reset(bankDetailsValues(answer.bankDetails));
    toast({ title: "Bank details saved", description: "Tournaments that show bank transfer details now give players this account." });
  });

  const remove = async () => {
    const answer = await save.mutateAsync({ bankDetails: null });
    returnFocus.current = saveButton.current;
    form.reset(bankDetailsValues(answer.bankDetails));
    toast({ title: "Bank details removed", description: "No tournament shows bank transfer details now." });
  };

  return (
    <Card data-testid="club-payments">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Landmark className="h-5 w-5 text-primary" aria-hidden="true" />
          Bank transfer
        </CardTitle>
        <CardDescription>
          Let players pay their buy-in ahead by bank transfer. A player sees these details only after signing up for a tournament that shows
          them, never on your club page or the TV.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved ? null : (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground" data-testid="club-payments-none">
            No bank details yet: players pay at the door. Add them to offer bank transfer in a tournament&apos;s settings.
          </p>
        )}
        <BankDetailsChanges changes={payments.changes} timeZone={clubTimeZone(club)} />
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <FormField
              control={form.control}
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account name</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" maxLength={BANK_DETAILS_LIMITS.accountName} placeholder="Central Stars Poker Club" {...field} data-testid="bank-account-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accountNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account number</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="12-3456-7890123-00"
                      className="tabular-nums"
                      onChange={(event) => field.onChange(formatBankAccountInput(event.target.value))}
                      data-testid="bank-account-number"
                    />
                  </FormControl>
                  <FormDescription>Bank, branch, account and suffix: the dashes go in as you type.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bankName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank (optional)</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" maxLength={BANK_DETAILS_LIMITS.bankName} placeholder="ANZ" {...field} data-testid="bank-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="instructions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note for players (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={BANK_DETAILS_LIMITS.instructions} placeholder="Pay by 5 pm on the day" {...field} data-testid="bank-instructions" />
                  </FormControl>
                  <FormDescription>Shown under the transfer details. Up to {BANK_DETAILS_LIMITS.instructions} characters.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end [&>button]:min-h-11">
              {saved ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setRemoving(true);
                  }}
                  data-testid="bank-details-remove"
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Remove bank details
                </Button>
              ) : null}
              <Button ref={saveButton} type="submit" busy={save.isPending} data-testid="bank-details-save">
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                {save.isPending ? "Saving…" : "Save bank details"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the bank details?"
        description="Tournaments stop showing bank transfer details after sign-up, and players pay at the door. Each tournament keeps its setting for when you add details again."
        confirmLabel="Remove bank details"
        pendingLabel="Removing…"
        destructive
        onConfirm={remove}
        returnFocusTo={returnFocus}
        confirmTestId="bank-details-remove-confirm"
      />
    </Card>
  );
}

/**
 * Club settings → Payments (round 8, item 1): the bank account players may pay into ahead of a game,
 * for the club's owner, its managers and admins, and who changed it last. Saved whole; removing it
 * stops every tournament showing it.
 */
export function ClubPaymentsTab({ club }: { club: ClubDto }) {
  const payments = useClubPayments(club.id, club.viewer.canManage);
  return (
    <QueryState query={payments} errorTitle="The club's bank details could not be loaded">
      {(loaded) => <BankDetailsForm club={club} payments={loaded} />}
    </QueryState>
  );
}

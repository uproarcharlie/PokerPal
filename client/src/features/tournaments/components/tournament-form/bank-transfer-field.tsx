import type { Control } from "react-hook-form";
import { ExternalLink } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { clubSettingsHref } from "@/features/clubs/club-form";
import { useClubPayments } from "@/features/clubs/staff-hooks";
import type { TournamentFormValues } from "../../tournament-form";

const DESCRIPTION = "Players who sign up see the club's account, the buy-in to transfer and what to put on it. They can still pay at the door.";

/**
 * Why the switch cannot be used now, or null when it can: it needs the club's bank details (round 8).
 * While they load, or when they could not be read, it waits or leaves the server to refuse.
 */
function unavailable(club: ClubDto | undefined, payments: ReturnType<typeof useClubPayments>): "no-club" | "loading" | "no-details" | null {
  if (!club) return "no-club";
  if (payments.isLoading) return "loading";
  return payments.data && payments.data.bankDetails === null ? "no-details" : null;
}

/** "Add them in Club settings → Payments", opened beside the form so what was typed here stays. */
function AddBankDetails({ club }: { club: ClubDto }) {
  return (
    <>
      Add the club&apos;s bank details first, in{" "}
      <a
        href={clubSettingsHref(club.id, "payments")}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
        data-testid="add-bank-details"
      >
        Club settings → Payments
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      .
    </>
  );
}

/**
 * "Show bank transfer details after sign-up" (round 8, item 2): each sign-up is told how to pay the
 * buy-in into the club's account. Only for a club with bank details: without them the switch is off
 * and cannot be used, saying where to add them (the stored setting is left alone, so it comes back
 * with the details). The details are asked for again when the TD comes back from adding them, or
 * opens the form again.
 */
export function BankTransferField({ control, club }: { control: Control<TournamentFormValues>; club: ClubDto | undefined }) {
  const payments = useClubPayments(club?.id, club?.viewer.canManage === true, { fresh: true });
  const reason = unavailable(club, payments);
  return (
    <FormField
      control={control}
      name="showBankTransfer"
      render={({ field }) => (
        <FormItem className="flex flex-row items-center justify-between gap-4 space-y-0 rounded-lg border p-4" data-testid="bank-transfer-setting">
          <div className="space-y-0.5">
            <FormLabel className="text-base">Show bank transfer details after sign-up</FormLabel>
            <FormDescription>
              {reason === "no-details" && club ? (
                <AddBankDetails club={club} />
              ) : reason === "no-club" ? (
                "Choose a club first: its bank details are the ones players see."
              ) : reason === "loading" ? (
                "Checking the club's bank details…"
              ) : (
                DESCRIPTION
              )}
            </FormDescription>
            <FormMessage />
          </div>
          <FormControl>
            <Switch
              ref={field.ref}
              checked={reason === null && field.value === true}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              disabled={reason !== null}
              data-testid="show-bank-transfer"
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

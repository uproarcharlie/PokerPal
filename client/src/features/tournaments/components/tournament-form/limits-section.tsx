import { useWatch, type Control } from "react-hook-form";
import { AddressAutocomplete } from "@/features/clubs/components/address-autocomplete";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { ClubDto } from "@shared/api/public";
import type { TournamentFormValues } from "../../tournament-form";
import { FormSection } from "./form-section";
import { SwitchField } from "./toggle-fields";

interface LimitsSectionProps {
  control: Control<TournamentFormValues>;
  /** The tournament's club, for its address. */
  club: ClubDto | undefined;
}

/** How many players, and where the game is played. */
export function LimitsSection({ control, club }: LimitsSectionProps) {
  const useClubAddress = useWatch({ control, name: "useClubAddress" });

  return (
    <FormSection title="Player Limits">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="minPlayers"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Minimum Players</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder="8" {...field} data-testid="min-players" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="maxPlayers"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Maximum Players</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder="50" {...field} data-testid="max-players" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <h3 className="text-lg font-semibold text-foreground">Location</h3>
        <SwitchField control={control} name="useClubAddress" label="Use Club Address" description="Use the address from the selected club" />
        {useClubAddress ? (
          club ? (
            <div className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
              {club.address ? (
                <>
                  <p>Address: {club.address}</p>
                  {club.timezone ? <p className="mt-1 text-xs">Timezone: {club.timezone}</p> : null}
                </>
              ) : (
                <p>No address set for this club</p>
              )}
            </div>
          ) : null
        ) : (
          <FormField
            control={control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tournament Address</FormLabel>
                <FormControl>
                  <AddressAutocomplete value={field.value} onChange={(address) => field.onChange(address)} placeholder="Start typing an address..." />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>
    </FormSection>
  );
}

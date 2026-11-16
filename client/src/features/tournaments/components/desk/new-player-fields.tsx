import { useState, type KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { UserPlus } from "lucide-react";
import { createPlayerSchema, normaliseName, normalisePhone, type CreatePlayerInput } from "@shared/api/players";
import type { PublicPlayer } from "@shared/api/public";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SameNameSuggestion, useSameNameLookup, type SameNameWording } from "@/features/public-tournament/components/player-search";
import { useCreatePlayer } from "@/features/public-tournament/hooks";
import { checkMobile, MOBILE_LABEL } from "@/features/public-tournament/registration";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formResolver, showServerFieldErrors } from "@/lib/forms";

/** A new player at the desk: a name, and a mobile number if they give one (round 7, item 9). */
const newPlayerSchema = createPlayerSchema.pick({ name: true, phone: true }).superRefine(checkMobile);
type NewPlayerDetails = Pick<CreatePlayerInput, "name" | "phone">;

interface NewPlayerValues {
  name: string;
  phone: string;
}

const FIELDS = ["name", "phone"] as const;

const STAFF_SAME_NAME: SameNameWording = {
  title: "Played before?",
  description: (count) =>
    count === 1
      ? "Someone with this name has played before. If it's them, pick them, so their results stay together."
      : "Players with this name have played before. If one of them is this player, pick them, so their results stay together.",
  choose: "That's them",
};

/** The player the sheet will register, and how they came to be on it. */
interface Added {
  player: PublicPlayer;
  how: "created" | "phone" | "name";
}

const HOW: Readonly<Record<Added["how"], string>> = {
  created: "New player added",
  phone: "Has played before: found by their mobile number",
  name: "Has played before",
};

interface NewPlayerFieldsProps {
  tournamentId: string;
  /** The id of the visible words that name these boxes (the sheet's "Player"). */
  labelledBy?: string;
  /** Picks the player the sheet registers: the one added or found here, or nobody again. */
  onChoose: (player: PublicPlayer | null) => void;
  /** Back to the search for someone who has played before. */
  onSearch: () => void;
}

/**
 * The Register player sheet's new player (round 7, item 9): their name and, if they give one, their
 * mobile number. The players with that name come first ("That's them"), with or without a number, so a
 * returning player is not added twice (one added by name only has no number to be found by:
 * R7FREV1-02); "No, add a new player" then sends the number, and the server finds them by it as the QR
 * page's sign-up does (same number and name), or says the number is someone else's. The tournament's club becomes a
 * new player's home club. Drawn inside the sheet's own form, so it is a group of boxes, not a form:
 * Enter in a box adds the player rather than registering nobody.
 */
export function NewPlayerFields({ tournamentId, labelledBy, onChoose, onSearch }: NewPlayerFieldsProps) {
  const { toast } = useToast();
  const createPlayer = useCreatePlayer();
  const lookUpSameName = useSameNameLookup(tournamentId);
  const [checking, setChecking] = useState(false);
  const [sameName, setSameName] = useState<{ details: NewPlayerDetails; players: PublicPlayer[] } | null>(null);
  const [added, setAdded] = useState<Added | null>(null);
  const form = useForm<NewPlayerValues>({ resolver: formResolver(newPlayerSchema), defaultValues: { name: "", phone: "" } });
  const [name, phone] = useWatch({ control: form.control, name: ["name", "phone"] });
  // Offered only while the boxes still hold the name and number it was found for.
  const suggestion =
    sameName && normaliseName(sameName.details.name) === normaliseName(name) && normalisePhone(sameName.details.phone) === normalisePhone(phone) ? sameName : null;

  const choose = (player: PublicPlayer, how: Added["how"]) => {
    setSameName(null);
    setAdded({ player, how });
    onChoose(player);
  };

  const create = async (details: NewPlayerDetails) => {
    try {
      const created = await createPlayer.mutateAsync({ name: details.name, phone: details.phone, tournamentId });
      choose({ id: created.id, name: created.name, imageUrl: created.imageUrl }, created.existing ? "phone" : "created");
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { PHONE_TAKEN: "phone" } })) {
        toast({ title: "Could not add the player", description: errorMessage(error), variant: "destructive" });
      }
    }
  };

  const add = form.handleSubmit(async (values) => {
    const details = newPlayerSchema.parse(values);
    setSameName(null);
    // With a number too: a player added by name only before has none stored to be found by (R7FREV1-02).
    setChecking(true);
    // A search that cannot be asked just now does not stop the TD adding the player.
    const players = await lookUpSameName(details.name).catch((): PublicPlayer[] => []);
    setChecking(false);
    if (players.length > 0) {
      setSameName({ details, players });
      return;
    }
    await create(details);
  });

  const addOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void add();
  };

  /** Edit the details again: the sheet registers nobody until a player is added or picked. */
  const change = () => {
    setAdded(null);
    onChoose(null);
  };

  if (added) {
    return (
      <div className="flex items-center gap-3 rounded-lg border-2 border-primary bg-primary/5 px-3 py-2" data-testid="new-player-added">
        <PlayerAvatar name={added.player.name} imageUrl={added.player.imageUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-foreground">{added.player.name}</p>
          <p className="text-xs text-muted-foreground">{HOW[added.how]}</p>
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0 px-3 sm:h-10" onClick={change} data-testid="new-player-change">
          Change
        </Button>
      </div>
    );
  }

  const busy = checking || createPlayer.isPending;
  return (
    <Form {...form}>
      <div role="group" aria-labelledby={labelledBy} className="space-y-4 rounded-lg border border-border p-3" data-testid="new-player-fields">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Sam Taylor" autoComplete="off" className="h-11 sm:h-10" {...field} onKeyDown={addOnEnter} data-testid="new-player-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{MOBILE_LABEL}</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="e.g. 021 123 4567"
                  autoComplete="off"
                  className="h-11 sm:h-10"
                  {...field}
                  onKeyDown={addOnEnter}
                  data-testid="new-player-phone"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {suggestion ? <SameNameSuggestion players={suggestion.players} onChoose={(player) => choose(player, "name")} wording={STAFF_SAME_NAME} /> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={onSearch} data-testid="new-player-search">
            Search instead
          </Button>
          {suggestion ? (
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => void create(suggestion.details)} busy={busy} data-testid="same-name-new">
              No, add a new player
            </Button>
          ) : (
            <Button type="button" variant="secondary" className="h-11 sm:h-10" onClick={() => void add()} busy={busy} data-testid="new-player-add">
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              {busy ? "Adding…" : "Add player"}
            </Button>
          )}
        </div>
      </div>
    </Form>
  );
}

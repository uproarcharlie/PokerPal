import { useId } from "react";
import { useFieldArray, useFormState, useWatch, type Control } from "react-hook-form";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { AmountInput } from "@/components/shared/amount-input";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { RakeType } from "@shared/api/common";
import { HIGH_HAND_LIMITS, highHandLabel } from "@shared/domain/high-hands";
import { formatMoney, toCents } from "@shared/domain/money";
import {
  allHighHandsText,
  canAddHighHand,
  newHighHand,
  removeBlockedBecause,
  TWO_HIGH_HANDS_FEE,
  twoHighHandsValues,
  winnerChoices,
  type HighHandsFormValues,
} from "../../high-hands-form";

interface HighHandsEditorProps {
  control: Control<HighHandsFormValues>;
  /** The club's name for its take ("AP"). */
  rakeLabel: string;
  /** How many players are in each saved high hand (by id): one anyone is in stays on the list. */
  entrants: Readonly<Record<string, number>>;
}

const TWO_HIGH_HANDS = `Two high hands at ${formatMoney(toCents(TWO_HIGH_HANDS_FEE))} each`;

/**
 * The high hands (round 10: "players will only want to sign up to one of the high hands … so they pay
 * 5 instead of 10"): each its own pot with its own fee, number of prizes, AP and note, in the order
 * the players see them, added, taken off (only while nobody is in one), renamed and moved, with what
 * entering all of them costs and a one-tap "Two high hands at $5 each". The tournament form and the
 * Money tab's editor both hold it; their schema checks each card's boxes.
 */
export function HighHandsEditor({ control, rakeLabel, entrants }: HighHandsEditorProps) {
  const { fields, append, remove, move, replace } = useFieldArray({ control, name: "highHands" });
  const values = useWatch({ control, name: "highHands" }) ?? [];

  return (
    <div className="space-y-4" data-testid="high-hands-editor">
      <p className="text-sm text-muted-foreground">
        Each high hand is a pot of its own, paid at the door. Players tick the ones they want; only paid players are in a pot, and its
        winners share it less its {rakeLabel}.
      </p>
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground" data-testid="no-high-hands">
          No high hand in this game.
        </p>
      ) : (
        <ol role="list" className="space-y-3">
          {fields.map((field, index) => (
            <HighHandCard
              key={field.id}
              control={control}
              index={index}
              count={fields.length}
              rakeLabel={rakeLabel}
              removeBlocked={removeBlockedBecause(values[index] ?? field, entrants)}
              onMove={(to) => move(index, to)}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
      )}
      {fields.length >= 2 ? (
        <p className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" data-testid="all-high-hands-total">
          <span>All high hands</span>
          <span className="tabular-nums">{allHighHandsText(values)}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-10"
          disabled={!canAddHighHand(fields)}
          onClick={() => append(newHighHand(values))}
          data-testid="add-high-hand"
        >
          <Plus aria-hidden="true" />
          Add a high hand
        </Button>
        {/* With one high hand at most: that one (its players and winners too) becomes the first half. */}
        {fields.length <= 1 ? (
          <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => replace(twoHighHandsValues(values))} data-testid="two-high-hands">
            <Sparkles aria-hidden="true" />
            {TWO_HIGH_HANDS}
          </Button>
        ) : null}
      </div>
      {fields.length >= HIGH_HAND_LIMITS.maxHighHands ? (
        <p className="text-xs text-muted-foreground">A game runs at most {HIGH_HAND_LIMITS.maxHighHands} high hands.</p>
      ) : null}
    </div>
  );
}

interface HighHandCardProps {
  control: Control<HighHandsFormValues>;
  index: number;
  count: number;
  rakeLabel: string;
  /** Why it cannot be taken off (players are in it), or null. */
  removeBlocked: string | null;
  onMove: (to: number) => void;
  onRemove: () => void;
}

/** One high hand's boxes: its name, fee, prizes, AP and note, and moving or removing it. */
function HighHandCard({ control, index, count, rakeLabel, removeBlocked, onMove, onRemove }: HighHandCardProps) {
  const ids = useId();
  const [name, rakeType, winners] = useWatch({ control, name: [`highHands.${index}.name`, `highHands.${index}.rakeType`, `highHands.${index}.winners`] });
  const { errors } = useFormState({ control, name: `highHands.${index}` });
  const problem = errors.highHands?.[index]?.message;
  const label = name?.trim() ? highHandLabel(name) : `High hand ${index + 1}`;

  return (
    <li className="space-y-3 rounded-lg border border-border bg-muted/20 p-3 sm:p-4" data-testid={`high-hand-card-${index}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
          {index + 1}
        </span>
        <p id={`${ids}-title`} className="min-w-0 flex-1 truncate font-medium text-foreground">
          {label}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-10 sm:w-10"
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
          aria-label={`Move the ${label} up`}
          data-testid={`move-high-hand-up-${index}`}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-10 sm:w-10"
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
          aria-label={`Move the ${label} down`}
          data-testid={`move-high-hand-down-${index}`}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 text-destructive sm:h-10 sm:w-10"
          disabled={removeBlocked !== null}
          onClick={onRemove}
          aria-label={`Remove the ${label}`}
          aria-describedby={removeBlocked ? `${ids}-kept` : undefined}
          data-testid={`remove-high-hand-${index}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      {removeBlocked ? (
        <p id={`${ids}-kept`} className="text-xs text-muted-foreground">
          {removeBlocked}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-medium text-destructive" data-testid={`high-hand-problem-${index}`}>
          {problem}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`highHands.${index}.name`}
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} maxLength={HIGH_HAND_LIMITS.maxNameLength} placeholder="First half" className="h-11 sm:h-10" data-testid={`high-hand-name-${index}`} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`highHands.${index}.entryFee`}
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Entry fee</FormLabel>
              <FormControl>
                <AmountInput unit="$" placeholder="5" {...field} className="h-11 sm:h-10" data-testid={`high-hand-fee-${index}`} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name={`highHands.${index}.winners`}
        render={({ field }) => (
          <FormItem>
            <p id={`${ids}-winners`} className="text-sm font-medium leading-none">
              Prizes
            </p>
            <RadioGroupPrimitive.Root
              aria-labelledby={`${ids}-winners`}
              value={field.value}
              onValueChange={field.onChange}
              disabled={field.disabled}
              className="flex gap-1"
              data-testid={`high-hand-winners-${index}`}
            >
              {winnerChoices(winners ?? field.value).map((choice) => (
                <RadioGroupPrimitive.Item
                  key={choice}
                  value={choice}
                  aria-label={choice === "1" ? "1 winner" : `${choice} winners`}
                  className={cn(
                    "h-11 min-w-11 flex-1 rounded-md border border-border px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-10",
                    "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
                  )}
                  data-testid={`high-hand-winners-${index}-${choice}`}
                >
                  {choice}
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`highHands.${index}.rakeType`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{rakeLabel}</FormLabel>
              <FormControl>
                <NativeSelect
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(event.target.value as RakeType)}
                  disabled={field.disabled}
                  className="h-11 sm:h-10"
                  data-testid={`high-hand-rake-type-${index}`}
                >
                  <option value="none">No {rakeLabel}</option>
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed amount ($)</option>
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {rakeType && rakeType !== "none" ? (
          <FormField
            control={control}
            name={`highHands.${index}.rakeAmount`}
            render={({ field }) => (
              <FormItem required>
                <FormLabel>{rakeType === "percentage" ? `${rakeLabel} percentage` : `${rakeLabel} amount (from the pot)`}</FormLabel>
                <FormControl>
                  <AmountInput
                    {...field}
                    unit={rakeType === "percentage" ? "%" : "$"}
                    placeholder={rakeType === "percentage" ? "10" : "5"}
                    className="h-11 sm:h-10"
                    data-testid={`high-hand-rake-amount-${index}`}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
      </div>

      <FormField
        control={control}
        name={`highHands.${index}.note`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Note (optional)</FormLabel>
            <FormControl>
              <Input {...field} maxLength={HIGH_HAND_LIMITS.maxNoteLength} placeholder="Before the break" className="h-11 sm:h-10" data-testid={`high-hand-note-${index}`} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </li>
  );
}

import { useId } from "react";
import { Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AmountInput } from "@/components/shared/amount-input";
import { formatMoney, ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Dealable, DealProblem } from "@shared/domain/deal";
import { UNKNOWN_PLAYER } from "../../player-name";
import { dealReasons, dealTotalText, evenDraft, startDeal, type DealDraft, type DealDraftState } from "./deal";

interface DealEditorProps {
  dealable: Dealable;
  /** The players still in, best first, as the finishing order shows them. */
  order: readonly string[];
  draft: DealDraft;
  onChange: (draft: DealDraft) => void;
  /** What is wrong with the draft (draftProblems): each under its player, the rest under the total or the reason. */
  problems: readonly DealProblem[];
  onCancel: () => void;
  disabled: boolean;
}

/**
 * A deal at the end (round 5, item 2): one amount for each player still in, starting from what their
 * place pays, with an even chop one tap away, the running total against what they share, and the
 * reason the feed shows. Positions and season points still follow the finishing order.
 */
export function DealEditor({ dealable, order, draft, onChange, problems, onCancel, disabled }: DealEditorProps) {
  const ids = useId();
  const byId = new Map(dealable.players.map((player) => [player.registrationId, player]));
  const shown = order.filter((id) => byId.has(id));
  const total = dealTotalText(dealable, draft);
  const problemOf = (registrationId: string) => problems.find((problem) => problem.registrationId === registrationId && problem.code === "DEAL_AMOUNT");
  const totalProblem = problems.find((problem) => problem.code === "DEAL_TOTAL" || problem.code === "DEAL_PLAYERS" || problem.code === "DEAL_TOO_FEW_PLAYERS");
  const reasonProblem = problems.find((problem) => problem.code === "DEAL_REASON");
  const setAmount = (registrationId: string, text: string) => onChange({ ...draft, amounts: { ...draft.amounts, [registrationId]: text } });
  const reasons = dealReasons(dealable.players.length);

  return (
    <section aria-labelledby={`${ids}-title`} className="space-y-3 rounded-lg border border-primary/40 p-3" data-testid="deal-editor">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${ids}-title`} className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Handshake className="h-4 w-4" aria-hidden="true" />
          Deal
        </h3>
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel} disabled={disabled} data-testid="cancel-deal">
          No deal
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        The {dealable.players.length} players still in share {formatMoney(dealable.totalCents)}, what their places pay together. Their places and
        season points still follow the finishing order.
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full sm:w-auto"
        onClick={() => onChange(evenDraft(draft, dealable, shown))}
        disabled={disabled}
        data-testid="even-chop"
      >
        Even chop
      </Button>

      <ol role="list" className="space-y-3" aria-label="What each player gets">
        {shown.map((registrationId) => {
          const player = byId.get(registrationId);
          const inputId = `${ids}-${registrationId}`;
          const problem = problemOf(registrationId);
          const planned =
            player?.position != null && player.plannedCents != null ? `${ordinal(player.position)} pays ${formatMoney(player.plannedCents)}` : null;
          return (
            <li key={registrationId} className="space-y-1" data-testid={`deal-row-${registrationId}`}>
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={inputId} className="min-w-0 truncate">
                  {player?.playerName ?? UNKNOWN_PLAYER}
                </Label>
                {planned ? (
                  <span id={`${inputId}-planned`} className="shrink-0 text-xs text-muted-foreground">
                    {planned}
                  </span>
                ) : null}
              </div>
              <AmountInput
                id={inputId}
                unit="$"
                className="h-11 text-base"
                value={draft.amounts[registrationId] ?? ""}
                onChange={(event) => setAmount(registrationId, event.target.value)}
                disabled={disabled}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${inputId}-error` : planned ? `${inputId}-planned` : undefined}
              />
              {problem ? (
                <p id={`${inputId}-error`} className="text-sm font-medium text-destructive">
                  {problem.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p
        aria-live="polite"
        className={cn("rounded-md border p-2 text-sm font-medium tabular-nums", total.adds ? "border-border text-foreground" : "border-destructive/50 text-destructive")}
        data-testid="deal-total"
      >
        {total.text}
      </p>
      {totalProblem && totalProblem.code !== "DEAL_TOTAL" ? <p className="text-sm font-medium text-destructive">{totalProblem.message}</p> : null}

      <div className="space-y-2">
        <Label htmlFor={`${ids}-reason`}>What was agreed</Label>
        <div role="group" aria-label="Common deals" className="flex flex-wrap gap-2">
          {reasons.map((choice) => (
            <Button
              key={choice}
              type="button"
              variant="outline"
              className="h-11 px-3"
              aria-pressed={draft.reason.trim() === choice}
              onClick={() => onChange({ ...draft, reason: draft.reason.trim() === choice ? "" : choice })}
              disabled={disabled}
            >
              {choice}
            </Button>
          ))}
        </div>
        <Input
          id={`${ids}-reason`}
          className="h-11"
          maxLength={200}
          value={draft.reason}
          onChange={(event) => onChange({ ...draft, reason: event.target.value })}
          placeholder="Or type what was agreed"
          disabled={disabled}
          aria-invalid={reasonProblem && draft.reason !== "" ? true : undefined}
          aria-describedby={`${ids}-reason-help`}
        />
        <p id={`${ids}-reason-help`} className="text-xs text-muted-foreground">
          Required. Shown with the deal in the public activity feed.
        </p>
      </div>
    </section>
  );
}

interface DealSectionProps {
  deal: DealDraftState;
  /** The players still in, best first, as the finishing order shows them. */
  order: readonly string[];
  /** Any change to the deal: the dialog clears what it last said. */
  onEdit: () => void;
  disabled: boolean;
}

/** "Make a deal", or the deal being made: the same in End Tournament and Correct Results (R5REV3-CQ-02). Nothing with nobody to deal with. */
export function DealSection({ deal, order, onEdit, disabled }: DealSectionProps) {
  const { dealable, draft, setDraft, problems } = deal;
  if (!dealable) return null;
  if (!draft) {
    return (
      <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setDraft(startDeal(dealable))} data-testid="make-deal">
        <Handshake aria-hidden="true" />
        Make a deal
      </Button>
    );
  }
  return (
    <DealEditor
      dealable={dealable}
      order={order}
      draft={draft}
      onChange={(next) => {
        onEdit();
        setDraft(next);
      }}
      problems={problems}
      onCancel={() => setDraft(null)}
      disabled={disabled}
    />
  );
}

/** Under the plan while the deal typed cannot be paid yet. */
export function DealPendingNote({ deal }: { deal: DealDraftState }) {
  return deal.draft && deal.problems.length > 0 ? (
    <p className="text-sm text-muted-foreground" data-testid="deal-pending">
      Fix the deal, or choose No deal, to finalize.
    </p>
  ) : null;
}

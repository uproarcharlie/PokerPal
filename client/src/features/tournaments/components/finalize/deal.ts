/**
 * A deal (a "chop") as the TD types it in the End Tournament and Correct Results dialogs (round 5,
 * item 2): an amount for each player still in and the reason, checked with the rules finalize checks
 * them by (shared/domain/deal dealProblems), and sent with the preview only once it can be paid, so
 * the plan shown, and its hash, are the deal's.
 */
import { useState } from "react";
import { moneySchema } from "@shared/api/common";
import type { DealRequest, FinalizePreviewDto } from "@shared/api/finalize";
import { dealProblems, evenChop, type Dealable, type DealProblem, type SnapshotDeal } from "@shared/domain/deal";
import { centsToDecimalString, formatMoney, toCents, type Cents } from "@shared/domain/money";
import { useDebounced } from "@/hooks/use-debounced";
import { amountBoxText } from "@/lib/format";

/** The deal as its boxes hold it: the amount typed for each player still in (by registration id), and why. */
export interface DealDraft {
  amounts: Readonly<Record<string, string>>;
  reason: string;
}

/** A new deal: each player starts from what their place pays (an empty box while the finishing order is not known). */
export function startDeal(dealable: Dealable): DealDraft {
  return {
    amounts: Object.fromEntries(dealable.players.map((player) => [player.registrationId, player.plannedCents === null ? "" : amountBoxText(player.plannedCents)])),
    reason: "",
  };
}

/**
 * The deal the last finalize paid, to correct the results with (a correction without it pays the
 * places' payouts); null when there was none, or the players still in are not the same.
 */
export function previousDeal(dealable: Dealable | null, deal: SnapshotDeal | null | undefined): DealDraft | null {
  if (!dealable || !deal) return null;
  const stillIn = new Set(dealable.players.map((player) => player.registrationId));
  if (deal.players.length !== stillIn.size || !deal.players.every((player) => stillIn.has(player.registrationId))) return null;
  return { amounts: Object.fromEntries(deal.players.map((player) => [player.registrationId, amountBoxText(player.amountCents)])), reason: deal.reason };
}

/** "Even chop": what the players share split equally in whole dollars, the odd dollars and cents to the one shown first. */
export function evenDraft(draft: DealDraft, dealable: Dealable, order: readonly string[]): DealDraft {
  const amounts = evenChop(dealable.totalCents, order).map(({ registrationId, amountCents }) => [registrationId, amountBoxText(amountCents)]);
  return { ...draft, amounts: Object.fromEntries(amounts) };
}

/** The cents a box holds, or null while it is not an amount ("12", "12.5", "12.50"). */
export function typedCents(text: string | undefined): Cents | null {
  const parsed = moneySchema.safeParse((text ?? "").trim());
  return parsed.success ? toCents(parsed.data) : null;
}

/** What is wrong with the deal typed: finalize's own rules, a box that is not an amount yet counting as a wrong amount. */
export function draftProblems(dealable: Dealable, draft: DealDraft): DealProblem[] {
  const amounts = dealable.players.map(({ registrationId }) => ({ registrationId, amountCents: typedCents(draft.amounts[registrationId]) ?? Number.NaN }));
  return dealProblems(dealable, { amounts, reason: draft.reason });
}

/** The deal to send with the preview and finalize, once it can be paid; null while it has a problem. */
export function dealRequest(dealable: Dealable, draft: DealDraft): DealRequest | null {
  if (draftProblems(dealable, draft).length > 0) return null;
  return {
    amounts: dealable.players.map(({ registrationId }) => ({ registrationId, amount: centsToDecimalString(typedCents(draft.amounts[registrationId]) ?? 0) })),
    reason: draft.reason.trim(),
  };
}

/** The running total beside what the players still in share: "$590 of $600: $10 short". */
export function dealTotalText(dealable: Dealable, draft: DealDraft): { text: string; adds: boolean } {
  const shared = dealable.players.reduce((sum, { registrationId }) => sum + (typedCents(draft.amounts[registrationId]) ?? 0), 0);
  const total = dealable.totalCents;
  if (shared === total) return { text: `${formatMoney(shared)} of ${formatMoney(total)}: it adds up`, adds: true };
  const off = shared < total ? `${formatMoney(total - shared)} short` : `${formatMoney(shared - total)} too much`;
  return { text: `${formatMoney(shared)} of ${formatMoney(total)}: ${off}`, adds: false };
}

/** The reasons a deal is usually made, one tap each: "Chip chop at 3 handed". */
export const dealReasons = (players: number) => [`Chip chop at ${players} handed`, `Even chop at ${players} handed`, `ICM chop at ${players} handed`];

/** How long typing settles before a deal is previewed on the server. */
export const DEAL_PREVIEW_DELAY_MS = 300;

/**
 * The deal the preview is asked with, and whether the plan on screen is that deal's: the request once
 * the draft can be paid and the TD has stopped typing (by its text, so a new object each render is not
 * a change).
 */
export function useDealPreview(dealable: Dealable | null, draft: DealDraft | null): { deal: DealRequest | undefined; ready: boolean } {
  const request = draft && dealable ? dealRequest(dealable, draft) : null;
  const key = request ? JSON.stringify(request) : "";
  const settledKey = useDebounced(key, DEAL_PREVIEW_DELAY_MS);
  const deal = draft && settledKey ? (JSON.parse(settledKey) as DealRequest) : undefined;
  return { deal, ready: draft === null || (key !== "" && settledKey === key) };
}

/** A deal being made in the End Tournament or Correct Results dialog, and what the dialog does with it. */
export interface DealDraftState {
  /** What the players still in share, from the latest plan; null with fewer than two of them. */
  dealable: Dealable | null;
  /** The deal being typed, or null for none. */
  draft: DealDraft | null;
  setDraft: (draft: DealDraft | null) => void;
  /** What is wrong with the draft (draftProblems); none without one. */
  problems: DealProblem[];
  /** The deal to send with the preview and finalize, once it can be paid. */
  deal: DealRequest | undefined;
  /** Whether the plan on screen is the draft's (no deal, or the deal previewed). */
  ready: boolean;
  /**
   * Called while rendering with each plan as it arrives (the preview's own data, not its placeholder):
   * what the deal shares follows the players still in; with fewer than two left there is nobody to deal
   * with. The first plan also brings back `previous` (a correction's last deal) when it fits.
   */
  follow: (current: FinalizePreviewDto | undefined) => void;
}

/**
 * The deal of both finalize dialogs (R5REV3-CQ-02): its draft, what it shares, its problems and its
 * preview. `previous`: the deal the last finalize paid, to start a correction from (undefined while it is
 * still loading, null for none or for a first finalize).
 */
export function useDealDraft({ previous = null }: { previous?: SnapshotDeal | null } = {}): DealDraftState {
  const [draft, setDraft] = useState<DealDraft | null>(null);
  const [dealable, setDealable] = useState<Dealable | null>(null);
  const [seen, setSeen] = useState<FinalizePreviewDto | undefined>(undefined);
  const [prefilled, setPrefilled] = useState(false);
  const { deal, ready } = useDealPreview(dealable, draft);

  const follow = (current: FinalizePreviewDto | undefined) => {
    if (current !== seen) {
      setSeen(current);
      if (current) {
        setDealable(current.dealable);
        if (!current.dealable) setDraft(null);
      }
    }
    if (!prefilled && current && previous !== undefined) {
      setPrefilled(true);
      const last = previousDeal(current.dealable, previous);
      if (last) setDraft(last);
    }
  };

  return { dealable, draft, setDraft, problems: draft && dealable ? draftProblems(dealable, draft) : [], deal, ready, follow };
}

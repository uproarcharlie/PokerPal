/**
 * What the services return, once serialised, is the shared DTO the client reads, each assignable to
 * the other (P2REV4-07): a change on either side fails `npm run typecheck`. The tournament and
 * prize-pool DTOs have their own pairs in their API tests.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { AuthMeResponse } from "@shared/api/auth";
import type { Json } from "@shared/api/common";
import type { ConfirmPendingActionResponse, PendingActionDto } from "@shared/api/pending-actions";
import type { ClubPlayer, CreatePlayerResponse, StaffPlayer } from "@shared/api/players";
import type { ActivityDto, PublicPointsAllocation, PublicPointsSystem, PublicRegistration, WaitingListPlace } from "@shared/api/public";
import type {
  ConfirmedRegistrationDto,
  ManagedRegistration,
  PaymentConfirmedDto,
  PendingRegistrationDto,
  RegistrationCreatedDto,
} from "@shared/api/registrations";
import type { tournamentActivity } from "./activity";
import type { SessionDescription } from "./auth";
import type { confirmPendingAction, createPendingAction, listPendingActions } from "./pending-actions";
import type { createAllocation, createPointsSystem, listAllocations } from "./points";
import type { toClubPlayer, toPublicPlayer, toStaffPlayer } from "./players";
import type {
  adjustCounts,
  confirmPayment,
  listPaymentRegistrations,
  listRegistrations,
  registerPlayer,
  updateRegistration,
} from "./registrations";

/** What a service function's promise resolves to, as JSON. */
type Out<F extends (...args: never[]) => unknown> = Json<Awaited<ReturnType<F>>>;

describe("service results serialise to the shared DTOs", () => {
  it("activity", () => {
    expectTypeOf<Out<typeof tournamentActivity>[number]>().toExtend<ActivityDto>();
    expectTypeOf<ActivityDto>().toExtend<Out<typeof tournamentActivity>[number]>();
  });

  it("registrations", () => {
    expectTypeOf<Out<typeof listRegistrations>[number]>().toExtend<PublicRegistration | ManagedRegistration>();
    expectTypeOf<PublicRegistration>().toExtend<Out<typeof listRegistrations>[number]>();
    expectTypeOf<ManagedRegistration>().toExtend<Out<typeof listRegistrations>[number]>();
    expectTypeOf<Out<typeof registerPlayer>>().toExtend<RegistrationCreatedDto>();
    expectTypeOf<PublicRegistration & Pick<RegistrationCreatedDto, "seating">>().toExtend<Out<typeof registerPlayer>>();
    expectTypeOf<Out<typeof confirmPayment>>().toExtend<PaymentConfirmedDto>();
    expectTypeOf<PaymentConfirmedDto>().toExtend<Out<typeof confirmPayment>>();
    expectTypeOf<Out<typeof updateRegistration>>().toExtend<ManagedRegistration>();
    expectTypeOf<ManagedRegistration>().toExtend<Out<typeof updateRegistration>>();
    expectTypeOf<Out<typeof adjustCounts>>().toExtend<ManagedRegistration>();
    expectTypeOf<ManagedRegistration>().toExtend<Out<typeof adjustCounts>>();
    type PaymentRow = Out<typeof listPaymentRegistrations>[number];
    expectTypeOf<PaymentRow>().toExtend<PendingRegistrationDto | ConfirmedRegistrationDto>();
    // The payment desk's rows always say their place on the waiting list (optional in the DTO for older fixtures).
    expectTypeOf<PendingRegistrationDto & Required<WaitingListPlace>>().toExtend<PaymentRow>();
    expectTypeOf<ConfirmedRegistrationDto & Required<WaitingListPlace>>().toExtend<PaymentRow>();
  });

  it("pending actions", () => {
    expectTypeOf<Out<typeof listPendingActions>[number]>().toExtend<PendingActionDto>();
    expectTypeOf<PendingActionDto>().toExtend<Out<typeof listPendingActions>[number]>();
    expectTypeOf<Out<typeof createPendingAction>>().toExtend<PendingActionDto>();
    expectTypeOf<Out<typeof confirmPendingAction>>().toExtend<ConfirmPendingActionResponse>();
    expectTypeOf<ConfirmPendingActionResponse>().toExtend<Out<typeof confirmPendingAction>>();
  });

  it("points systems and allocations", () => {
    expectTypeOf<Out<typeof createPointsSystem>>().toEqualTypeOf<Json<PublicPointsSystem>>();
    expectTypeOf<Out<typeof listAllocations>[number]>().toEqualTypeOf<Json<PublicPointsAllocation>>();
    // The create answers exactly what the list does: a column added later cannot reach one and not the other.
    expectTypeOf<Out<typeof createAllocation>>().toEqualTypeOf<Out<typeof listAllocations>[number]>();
  });

  it("players", () => {
    expectTypeOf<Json<ReturnType<typeof toStaffPlayer>>>().toExtend<StaffPlayer>();
    expectTypeOf<StaffPlayer>().toExtend<Json<ReturnType<typeof toStaffPlayer>>>();
    expectTypeOf<Json<ReturnType<typeof toClubPlayer>>>().toExtend<ClubPlayer>();
    expectTypeOf<ClubPlayer>().toExtend<Json<ReturnType<typeof toClubPlayer>>>();
    expectTypeOf<Json<ReturnType<typeof toStaffPlayer>> & { signUpToken: string }>().toExtend<CreatePlayerResponse>();
    expectTypeOf<Json<ReturnType<typeof toPublicPlayer>> & { signUpToken: string }>().toExtend<CreatePlayerResponse>();
  });

  it("the signed-in session", () => {
    expectTypeOf<Json<SessionDescription>>().toExtend<AuthMeResponse>();
    expectTypeOf<AuthMeResponse>().toExtend<Json<SessionDescription>>();
  });
});

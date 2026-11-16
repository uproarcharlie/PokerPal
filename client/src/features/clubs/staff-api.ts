/**
 * The club endpoints only the club's staff call (phase2-contracts §2.4): its staff list (owner and
 * admins), its bank details (round 8: owner, managers and admins), and every change to the club and
 * its staff. Apart from api.ts so the public club pages never load them (test/unit/public-bundle.test.ts).
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  ClubPaymentsDto,
  ClubStaffDto,
  CreateClubInput,
  CreateStaffInviteInput,
  CreateStaffInviteResponse,
  UpdateClubInput,
  UpdateClubPaymentsInput,
} from "@shared/api/clubs";
import type { ClubDto } from "@shared/api/public";
import { apiGet, apiSend, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { clubPath } from "./api";

export const clubStaffQueries = {
  /** The owner, managers and open invitations: answered for the club's owner and admins only. */
  staff: (id: string) =>
    queryOptions({ queryKey: qk.clubs.staff(id), queryFn: ({ signal }) => apiGet<ClubStaffDto>(`${clubPath(id)}/managers`, { signal }) }),
  /** The club's bank details (round 8), or none: answered for its owner, managers and admins only. */
  payments: (id: string) =>
    queryOptions({ queryKey: qk.clubs.payments(id), queryFn: ({ signal }) => apiGet<ClubPaymentsDto>(`${clubPath(id)}/payments`, { signal }) }),
};

export const createClub = (input: CreateClubInput) => apiSend<ClubDto>("POST", "/api/clubs", input);

export const updateClub = (id: string, input: UpdateClubInput) => apiSend<ClubDto>("PUT", clubPath(id), input);

export const deleteClub = (id: string) => apiSend("DELETE", clubPath(id));

/** Replaces the club's bank details whole, or removes them (`bankDetails: null`). */
export const updateClubPayments = (id: string, input: UpdateClubPaymentsInput) => apiSend<ClubPaymentsDto>("PUT", `${clubPath(id)}/payments`, input);

export const createStaffInvite = (clubId: string, input: CreateStaffInviteInput) =>
  apiSend<CreateStaffInviteResponse>("POST", `${clubPath(clubId)}/invites`, input);

export const revokeStaffInvite = (clubId: string, inviteId: string) =>
  apiSend<ClubStaffDto>("DELETE", `${clubPath(clubId)}/invites/${segment(inviteId)}`);

export const removeClubManager = (clubId: string, userId: string) =>
  apiSend<ClubStaffDto>("DELETE", `${clubPath(clubId)}/managers/${segment(userId)}`);

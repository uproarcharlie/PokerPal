/**
 * The club endpoints only the club's owner and admins call (phase2-contracts §2.4): its staff list,
 * and every change to the club and its staff. Apart from api.ts so the public club pages never load
 * them (test/unit/public-bundle.test.ts).
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  ClubStaffDto,
  CreateClubInput,
  CreateStaffInviteInput,
  CreateStaffInviteResponse,
  UpdateClubInput,
} from "@shared/api/clubs";
import type { ClubDto } from "@shared/api/public";
import { apiGet, apiSend, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { clubPath } from "./api";

export const clubStaffQueries = {
  /** The owner, managers and open invitations: answered for the club's owner and admins only. */
  staff: (id: string) =>
    queryOptions({ queryKey: qk.clubs.staff(id), queryFn: ({ signal }) => apiGet<ClubStaffDto>(`${clubPath(id)}/managers`, { signal }) }),
};

export const createClub = (input: CreateClubInput) => apiSend<ClubDto>("POST", "/api/clubs", input);

export const updateClub = (id: string, input: UpdateClubInput) => apiSend<ClubDto>("PUT", clubPath(id), input);

export const deleteClub = (id: string) => apiSend("DELETE", clubPath(id));

export const createStaffInvite = (clubId: string, input: CreateStaffInviteInput) =>
  apiSend<CreateStaffInviteResponse>("POST", `${clubPath(clubId)}/invites`, input);

export const revokeStaffInvite = (clubId: string, inviteId: string) =>
  apiSend<ClubStaffDto>("DELETE", `${clubPath(clubId)}/invites/${segment(inviteId)}`);

export const removeClubManager = (clubId: string, userId: string) =>
  apiSend<ClubStaffDto>("DELETE", `${clubPath(clubId)}/managers/${segment(userId)}`);

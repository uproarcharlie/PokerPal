import type { AcceptStaffInviteInput, AcceptStaffInviteResponse } from "@shared/api/clubs";
import { apiSend } from "@/lib/api/http";

/** POST /api/staff-invites/accept: the signed-in account joins the club's staff in the invited role. */
export const acceptStaffInvite = (input: AcceptStaffInviteInput) =>
  apiSend<AcceptStaffInviteResponse>("POST", "/api/staff-invites/accept", input);

/**
 * The staff player list and player edits (phase2-contracts §2.7). Every key comes from `qk`; every
 * type from shared/api.
 */
import { queryOptions } from "@tanstack/react-query";
import type { ClubPlayer, PlayersQuery, StaffPlayer, UpdatePlayerInput } from "@shared/api/players";
import { apiGet, apiSend, segment, withQuery } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";

export const playerQueries = {
  /** Players of the viewer's clubs (every player for an admin); `clubId` narrows it to one club. */
  list: (query: PlayersQuery = {}) =>
    queryOptions({
      queryKey: qk.players.list(query),
      queryFn: ({ signal }) => apiGet<ClubPlayer[]>(withQuery("/api/players", { clubId: query.clubId, q: query.q }), { signal }),
    }),
};

/** PUT /api/players/:id: absent fields are kept; null or blank clears one (a removed photo really goes). */
export const updatePlayer = ({ id, input }: { id: string; input: UpdatePlayerInput }) =>
  apiSend<StaffPlayer>("PUT", `/api/players/${segment(id)}`, input);

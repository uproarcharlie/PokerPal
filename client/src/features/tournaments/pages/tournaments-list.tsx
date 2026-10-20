import { useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateButton } from "@/components/shared/create-button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { routes, STAFF_HOME } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { useCreateFromLink } from "@/hooks/use-create-from-link";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { CreateTournamentDialog } from "../components/create-tournament-dialog";
import { EditTournamentDialog } from "../components/edit-tournament-dialog";
import { TournamentFilters, type TournamentFilterValues } from "../components/list/tournament-filters";
import { TournamentRows } from "../components/list/tournament-rows";
import { useClubs } from "@/features/clubs/hooks";
import { useTournaments } from "../hooks";

/** Every tournament the viewer can see, filtered by club and status, with what can be done with each. */
export default function TournamentsListPage() {
  usePageMeta({ title: "Tournaments" });
  const create = useCreateFromLink(routes.tournaments());
  const [editing, setEditing] = useState<TournamentListItemDto | null>(null);
  // The row menu Edit was chosen from: focus goes back to it when the settings close.
  const editMenu = useRef<HTMLElement | null>(null);
  const [filters, setFilters] = useState<TournamentFilterValues>({});
  const tournaments = useTournaments(filters);
  // Each row's club (its name, time zone and whether the viewer may edit it): the rows wait for the
  // clubs, so none reads "Unknown Club" at the wrong time while they load, or for good when they fail.
  const clubs = useClubs();
  const clubsById = new Map((clubs.data ?? []).map((club) => [club.id, club]));
  const filtered = filters.clubId !== undefined || filters.status !== undefined;

  const createButton = (label: string, testId: string) => <CreateButton label={label} testId={testId} onClick={() => create.setOpen(true)} />;
  const edit = (tournament: TournamentListItemDto, menu: HTMLElement | null) => {
    editMenu.current = menu;
    setEditing(tournament);
  };

  return (
    <>
      <PageHeader
        title="Tournaments"
        description="Manage all your poker tournaments"
        back={STAFF_HOME}
        actions={createButton("Create Tournament", "create-tournament-button")}
      />

      <div className="space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <Card>
          <CardHeader className="space-y-4 border-b border-border">
            <div>
              <CardTitle>All Tournaments</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Manage and view all tournament events</p>
            </div>
            <TournamentFilters clubs={clubs.data} value={filters} onChange={setFilters} />
          </CardHeader>
          <CardContent className="p-4 md:p-0">
            <QueryState
              query={tournaments}
              loading={<LoadingRows rows={4} className="md:p-6" />}
              errorTitle="The tournaments could not be loaded"
              empty={
                filtered ? (
                  <EmptyState
                    className="md:m-6"
                    title="No tournaments match these filters"
                    action={
                      <Button variant="outline" onClick={() => setFilters({})}>
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    className="md:m-6"
                    icon={<Trophy className="h-10 w-10" />}
                    title="No Tournaments Found"
                    description="Create your first tournament to start organizing poker events and managing player registrations."
                    action={createButton("Create Your First Tournament", "create-first-tournament")}
                  />
                )
              }
            >
              {(list) => (
                <QueryState query={clubs} loading={<LoadingRows rows={4} className="md:p-6" />} errorTitle="Your clubs could not be loaded">
                  {() => <TournamentRows tournaments={list} clubsById={clubsById} onEdit={edit} />}
                </QueryState>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </div>

      <CreateTournamentDialog open={create.open} onOpenChange={create.setOpen} clubId={create.clubId} />
      {editing ? (
        <EditTournamentDialog
          tournament={editing}
          club={clubsById.get(editing.clubId)}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          returnFocusTo={editMenu}
        />
      ) : null}
    </>
  );
}

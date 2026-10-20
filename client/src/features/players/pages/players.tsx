import { useState } from "react";
import { Link } from "wouter";
import { Info, Plus, UsersRound } from "lucide-react";
import type { ClubPlayer } from "@shared/api/players";
import type { ClubDto } from "@shared/api/public";
import { usePageMeta } from "@/app/page-meta";
import { routes, STAFF_HOME } from "@/app/routes";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { clubTimeZone, DEFAULT_TIME_ZONE, plural } from "@/lib/format";
import { ClubPicker } from "../components/club-picker";
import { EditPlayerSheet } from "../components/edit-player-sheet";
import { PlayersTable } from "../components/players-table";
import { useClubs } from "@/features/clubs/hooks";
import { usePlayers } from "../hooks";

const usersIcon = <UsersRound className="h-10 w-10" />;

function PlayersCard({ title, query, timeZone }: { title: string; query: ReturnType<typeof usePlayers>; timeZone: string }) {
  const [editing, setEditing] = useState<ClubPlayer | null>(null);
  return (
    <QueryState
      query={query}
      errorTitle="Players could not be loaded"
      empty={
        <EmptyState
          icon={usersIcon}
          title="No Players Yet"
          description="Players will appear here once they register for tournaments in this club."
          action={
            <Button asChild>
              <Link href={routes.tournaments()}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Create a Tournament
              </Link>
            </Button>
          }
        />
      }
    >
      {(players) => (
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>
              {plural(players.length, "player")} registered
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 md:p-0">
            <div className="p-4 md:p-0">
              <PlayersTable players={players} timeZone={timeZone} onEdit={setEditing} />
            </div>
          </CardContent>
          <EditPlayerSheet player={editing} onClose={() => setEditing(null)} />
        </Card>
      )}
    </QueryState>
  );
}

/** Every player, for an admin. */
function AllPlayers() {
  const players = usePlayers({});
  return <PlayersCard title="All Players" query={players} timeZone={DEFAULT_TIME_ZONE} />;
}

/** The players of one club the viewer runs, picked from a list. */
function ClubPlayers({ clubs }: { clubs: readonly ClubDto[] }) {
  const [clubId, setClubId] = useState("");
  const club = clubs.find((candidate) => candidate.id === clubId);
  const players = usePlayers({ clubId }, { enabled: Boolean(club) });

  if (clubs.length === 0) {
    return (
      <EmptyState
        icon={usersIcon}
        title="No Clubs Yet"
        description="You need to create a club first before you can view players. Players are automatically added when they register for your tournaments."
        action={
          <Button asChild>
            <Link href={routes.clubs()}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Create Your First Club
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <ClubPicker clubs={clubs} value={clubId} onChange={setClubId} />
      {club ? (
        <PlayersCard title={`Players - ${club.name}`} query={players} timeZone={clubTimeZone(club)} />
      ) : (
        <EmptyState icon={usersIcon} title="Select a Club" description="Choose a club from the list above to view its players." />
      )}
    </div>
  );
}

function ManagedClubPlayers() {
  const clubs = useClubs();
  return (
    <QueryState query={clubs} errorTitle="Your clubs could not be loaded" loading={<LoadingRows rows={4} />}>
      {(list) => <ClubPlayers clubs={list.filter((club) => club.viewer.canManage)} />}
    </QueryState>
  );
}

export default function PlayersPage() {
  usePageMeta({ title: "Players" });
  const { isAdmin } = useAuth();

  return (
    <>
      <PageHeader
        title="Player Management"
        description="View players who have registered for tournaments"
        back={STAFF_HOME}
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">Players are automatically created when they register for tournaments</p>
            <p className="mt-1 text-xs text-muted-foreground">
              To add players to your club, have them register for a tournament using the registration link or QR code.
            </p>
          </div>
        </div>
        {isAdmin ? <AllPlayers /> : <ManagedClubPlayers />}
      </div>
    </>
  );
}

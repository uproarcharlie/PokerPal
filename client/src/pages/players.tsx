import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditPlayerModal } from "@/components/modals/edit-player-modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, UsersRound, ArrowLeft, Eye, Edit, Mail, Phone, Filter, Download, Info } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { apiJson } from "@/lib/queryClient";
import type { Viewer } from "@shared/api/common";

interface Player {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  imageUrl?: string;
  createdAt: string;
  /** The viewer runs the player's home club (or is an admin): contact details and edits are theirs. */
  canEdit: boolean;
}

interface Club {
  id: string;
  name: string;
  viewer?: Viewer;
}

export default function Players() {
  const { isAdmin } = useAuth();
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [selectedClubId, setSelectedClubId] = useState<string>("");

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  // Clubs the user runs (owned or managed); an admin sees every player without choosing one.
  const ownedClubs = clubs.filter(club => club.viewer?.canManage);

  // GET /api/players is scoped by the server: a club's players are those who registered for its tournaments.
  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: ["/api/players", { clubId: isAdmin ? null : selectedClubId }],
    queryFn: () =>
      apiJson<Player[]>("GET", isAdmin ? "/api/players" : `/api/players?clubId=${encodeURIComponent(selectedClubId)}`),
    enabled: isAdmin || !!selectedClubId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="px-8 py-4">
            <div className="animate-pulse space-y-3">
              <div className="h-8 bg-muted rounded w-48"></div>
              <div className="h-4 bg-muted rounded w-64"></div>
            </div>
          </div>
        </header>
        <div className="p-8">
          <div className="h-96 bg-muted rounded animate-pulse"></div>
        </div>
      </div>
    );
  }

  const getPlayerInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const filteredPlayers = isAdmin || selectedClubId ? players : [];

  return (
    <>
      <div className="min-h-screen">
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <Link href="/clubs">
                  <Button variant="ghost" size="sm" data-testid="back-to-clubs">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                </Link>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Player Management</h2>
                  <p className="text-sm text-muted-foreground mt-1">View players who have registered for tournaments</p>
                </div>
              </div>
            </div>

            {/* Info banner */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-blue-900 dark:text-blue-100 font-medium">
                    Players are automatically created when they register for tournaments
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    To add players to your club, have them register for a tournament using the registration link or QR code.
                  </p>
                </div>
              </div>
            </div>

            {/* Club selector for non-admins */}
            {!isAdmin && (
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-foreground">Select Club:</label>
                {ownedClubs.length > 0 ? (
                  <Select value={selectedClubId} onValueChange={setSelectedClubId}>
                    <SelectTrigger className="w-[300px]">
                      <SelectValue placeholder="Choose a club to view its players" />
                    </SelectTrigger>
                    <SelectContent>
                      {ownedClubs.map((club) => (
                        <SelectItem key={club.id} value={club.id}>
                          {club.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">You don't run any clubs yet</span>
                    <Link href="/clubs">
                      <Button size="sm" variant="outline">
                        <Plus className="w-4 h-4 mr-1" />
                        Create Club
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="p-8">
          {!isAdmin && ownedClubs.length === 0 ? (
            <div className="text-center py-16">
              <UsersRound className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">No Clubs Yet</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                You need to create a club first before you can view players. Players are automatically added when they register for your tournaments.
              </p>
              <Link href="/clubs">
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Club
                </Button>
              </Link>
            </div>
          ) : !isAdmin && !selectedClubId ? (
            <div className="text-center py-16">
              <UsersRound className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">Select a Club</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Choose a club from the dropdown above to view its players.
              </p>
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="text-center py-16">
              <UsersRound className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">No Players Yet</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Players will appear here once they register for tournaments in this club.
              </p>
              <Link href="/tournaments">
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create a Tournament
                </Button>
              </Link>
            </div>
          ) : (
            <Card>
              <CardHeader className="border-b border-border flex flex-row items-center justify-between">
                <div>
                  <CardTitle>
                    {isAdmin ? "All Players" : `Players - ${clubs.find(c => c.id === selectedClubId)?.name}`}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''} registered
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Join Date</th>
                        <th className="text-right py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredPlayers.map((player) => {
                        return (
                          <tr key={player.id} className="hover:bg-muted/20 transition-colors" data-testid={`player-row-${player.id}`}>
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-3">
                                {player.imageUrl ? (
                                  <img
                                    src={player.imageUrl}
                                    alt={player.name}
                                    className="w-10 h-10 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                                    {getPlayerInitials(player.name)}
                                  </div>
                                )}
                                <div>
                                  <p className="font-medium text-foreground">{player.name}</p>
                                  <p className="text-sm text-muted-foreground">ID: {player.id.substring(0, 8)}...</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <div className="space-y-1">
                                {player.email && (
                                  <div className="flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground">{player.email}</span>
                                  </div>
                                )}
                                {player.phone && (
                                  <div className="flex items-center gap-2">
                                    <Phone className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground">{player.phone}</span>
                                  </div>
                                )}
                                {!player.canEdit ? (
                                  <span className="text-sm text-muted-foreground">Visiting from another club</span>
                                ) : (
                                  !player.email && !player.phone && <span className="text-sm text-muted-foreground">No contact info</span>
                                )}
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <span className="text-sm text-muted-foreground">
                                {new Date(player.createdAt).toLocaleDateString()}
                              </span>
                            </td>
                            <td className="py-4 px-6">
                              <div className="flex items-center justify-end gap-2">
                                <Button variant="ghost" size="sm" data-testid={`view-player-${player.id}`}>
                                  <Eye className="w-4 h-4 mr-1" />
                                  View
                                </Button>
                                {player.canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingPlayer(player)}
                                    data-testid={`edit-player-${player.id}`}
                                  >
                                    <Edit className="w-4 h-4 mr-1" />
                                    Edit
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <EditPlayerModal
        open={!!editingPlayer}
        onOpenChange={(open) => !open && setEditingPlayer(null)}
        player={editingPlayer}
      />
    </>
  );
}

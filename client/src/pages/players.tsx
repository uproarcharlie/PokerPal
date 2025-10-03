import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreatePlayerModal } from "@/components/modals/create-player-modal";
import { Plus, UsersRound, ArrowLeft, Eye, Edit, Mail, Phone, Filter, Download } from "lucide-react";
import { Link } from "wouter";

interface Player {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  createdAt: string;
}

export default function Players() {
  const [showCreatePlayer, setShowCreatePlayer] = useState(false);

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: ["/api/players"],
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

  return (
    <>
      <div className="min-h-screen">
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/">
                  <Button variant="ghost" size="sm" data-testid="back-to-dashboard">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                </Link>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Player Management</h2>
                  <p className="text-sm text-muted-foreground mt-1">Manage your poker players and their information</p>
                </div>
              </div>
              <Button onClick={() => setShowCreatePlayer(true)} data-testid="create-player-button">
                <Plus className="w-4 h-4 mr-2" />
                Create New Player
              </Button>
            </div>
          </div>
        </header>

        <div className="p-8">
          {players.length === 0 ? (
            <div className="text-center py-16">
              <UsersRound className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">No Players Found</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Create player profiles to register them for tournaments and track their performance across games.
              </p>
              <Button onClick={() => setShowCreatePlayer(true)} data-testid="create-first-player">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Player
              </Button>
            </div>
          ) : (
            <Card>
              <CardHeader className="border-b border-border flex flex-row items-center justify-between">
                <div>
                  <CardTitle>All Players</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Manage player profiles and information</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    <Filter className="w-4 h-4 mr-2" />
                    Filter
                  </Button>
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
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tournaments</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Points</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Join Date</th>
                        <th className="text-right py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {players.map((player) => (
                        <tr key={player.id} className="hover:bg-muted/20 transition-colors" data-testid={`player-row-${player.id}`}>
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                                {getPlayerInitials(player.name)}
                              </div>
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
                              {!player.email && !player.phone && (
                                <span className="text-sm text-muted-foreground">No contact info</span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div>
                              <p className="text-sm font-semibold text-foreground">0</p>
                              <p className="text-xs text-muted-foreground">tournaments played</p>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div>
                              <p className="text-sm font-semibold text-foreground">0</p>
                              <p className="text-xs text-muted-foreground">lifetime points</p>
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
                              <Button variant="ghost" size="sm" data-testid={`edit-player-${player.id}`}>
                                <Edit className="w-4 h-4 mr-1" />
                                Edit
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <CreatePlayerModal 
        open={showCreatePlayer} 
        onOpenChange={setShowCreatePlayer}
      />
    </>
  );
}

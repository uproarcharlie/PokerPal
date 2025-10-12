import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateClubModal } from "@/components/modals/create-club-modal";
import { Plus, Users, Eye, Settings as SettingsIcon, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Link, useLocation } from "wouter";

interface Club {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  createdAt: string;
}

interface Tournament {
  id: string;
  clubId: string;
  status: string;
}

interface Season {
  id: string;
  clubId: string;
  isActive: boolean;
  name: string;
}

export default function Clubs() {
  const [showCreateClub, setShowCreateClub] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [, setLocation] = useLocation();

  const toggleDescription = (clubId: string) => {
    setExpandedDescriptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(clubId)) {
        newSet.delete(clubId);
      } else {
        newSet.add(clubId);
      }
      return newSet;
    });
  };

  const { data: clubs = [], isLoading } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  const { data: tournaments = [] } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { data: seasons = [] } = useQuery<Season[]>({
    queryKey: ["/api/seasons"],
  });

  const { data: membersCountData = {} } = useQuery<Record<string, { count: number }>>({
    queryKey: ["/api/clubs/members-counts", clubs.map(c => c.id)],
    enabled: clubs.length > 0,
    queryFn: async () => {
      const counts: Record<string, { count: number }> = {};
      await Promise.all(
        clubs.map(async (club) => {
          const response = await fetch(`/api/clubs/${club.id}/members-count`);
          const data = await response.json();
          counts[club.id] = data;
        })
      );
      return counts;
    },
  });

  const getClubStats = (clubId: string) => {
    const clubTournaments = tournaments.filter(t => t.clubId === clubId);
    const activeTournaments = clubTournaments.filter(t => t.status === 'in_progress' || t.status === 'registration');
    const clubSeasons = seasons.filter(s => s.clubId === clubId);
    const activeSeason = clubSeasons.find(s => s.isActive);

    return {
      members: membersCountData[clubId]?.count || 0,
      activeTournaments: activeTournaments.length,
      totalTournaments: clubTournaments.length,
      activeSeason: activeSeason?.name || 'None'
    };
  };

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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-64 bg-muted rounded-lg animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
                  <h2 className="text-2xl font-bold text-foreground">Club Management</h2>
                  <p className="text-sm text-muted-foreground mt-1">Manage your poker clubs and settings</p>
                </div>
              </div>
              <Button onClick={() => setShowCreateClub(true)} data-testid="create-club-button">
                <Plus className="w-4 h-4 mr-2" />
                Create New Club
              </Button>
            </div>
          </div>
        </header>

        <div className="p-8">
          {clubs.length === 0 ? (
            <div className="text-center py-16">
              <Users className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">No Clubs Found</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Get started by creating your first poker club. Clubs help you organize tournaments and manage your poker community.
              </p>
              <Button onClick={() => setShowCreateClub(true)} data-testid="create-first-club">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Club
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {clubs.map((club) => (
                <Card key={club.id} className="hover:shadow-md transition-shadow" data-testid={`club-card-${club.id}`}>
                  <CardHeader>
                    <div className="flex items-start gap-4 mb-4">
                      {club.imageUrl ? (
                        <img
                          src={club.imageUrl}
                          alt={club.name}
                          className="w-16 h-16 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center text-white text-xl font-bold shrink-0">
                          {club.name.substring(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg">{club.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          Est. {new Date(club.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent>
                    {club.description && (
                      <div className="mb-4">
                        <div
                          className={`text-sm text-muted-foreground prose prose-sm max-w-none ${!expandedDescriptions.has(club.id) && club.description.length > 100 ? 'line-clamp-2' : ''}`}
                          dangerouslySetInnerHTML={{ __html: club.description }}
                        />
                        {club.description.length > 100 && (
                          <button
                            onClick={() => toggleDescription(club.id)}
                            className="text-xs text-primary hover:underline mt-1 flex items-center gap-1"
                          >
                            {expandedDescriptions.has(club.id) ? (
                              <>
                                Show less <ChevronUp className="w-3 h-3" />
                              </>
                            ) : (
                              <>
                                Show more <ChevronDown className="w-3 h-3" />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="space-y-3 mb-4">
                      {(() => {
                        const stats = getClubStats(club.id);
                        return (
                          <>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Members</span>
                              <span className="font-semibold text-foreground">{stats.members}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Active Tournaments</span>
                              <span className="font-semibold text-foreground">{stats.activeTournaments}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Total Tournaments</span>
                              <span className="font-semibold text-foreground">{stats.totalTournaments}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Active Season</span>
                              <span className="font-semibold text-foreground">{stats.activeSeason}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    <div className="pt-4 border-t border-border flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => setLocation(`/clubs/${club.id}`)}
                        data-testid={`view-club-${club.id}`}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => setLocation(`/clubs/${club.id}/settings`)}
                        data-testid={`settings-club-${club.id}`}
                      >
                        <SettingsIcon className="w-4 h-4 mr-1" />
                        Settings
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateClubModal
        open={showCreateClub}
        onOpenChange={setShowCreateClub}
      />
    </>
  );
}

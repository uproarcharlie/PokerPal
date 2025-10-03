import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateSeasonModal } from "@/components/modals/create-season-modal";
import { Plus, Calendar, ArrowLeft, Eye, Settings as SettingsIcon, Trophy, Users } from "lucide-react";
import { Link } from "wouter";

interface Season {
  id: string;
  name: string;
  clubId: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
}

interface Club {
  id: string;
  name: string;
}

export default function Seasons() {
  const [showCreateSeason, setShowCreateSeason] = useState(false);

  const { data: seasons = [], isLoading } = useQuery<Season[]>({
    queryKey: ["/api/seasons"],
  });

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-64 bg-muted rounded-lg animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const getClubName = (clubId: string) => {
    const club = clubs.find(c => c.id === clubId);
    return club?.name || 'Unknown Club';
  };

  const getClubInitials = (clubId: string) => {
    const clubName = getClubName(clubId);
    return clubName.substring(0, 2).toUpperCase();
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
                  <h2 className="text-2xl font-bold text-foreground">Season Management</h2>
                  <p className="text-sm text-muted-foreground mt-1">Manage tournament seasons and track player progress</p>
                </div>
              </div>
              <Button onClick={() => setShowCreateSeason(true)} data-testid="create-season-button">
                <Plus className="w-4 h-4 mr-2" />
                Create New Season
              </Button>
            </div>
          </div>
        </header>

        <div className="p-8">
          {seasons.length === 0 ? (
            <div className="text-center py-16">
              <Calendar className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">No Seasons Found</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Create seasons to organize your tournaments over time and track player leaderboards across multiple events.
              </p>
              <Button onClick={() => setShowCreateSeason(true)} data-testid="create-first-season">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Season
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {seasons.map((season) => (
                <Card key={season.id} className="hover:shadow-md transition-shadow" data-testid={`season-card-${season.id}`}>
                  <CardHeader>
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center text-white text-xl font-bold shrink-0">
                        <Calendar className="w-8 h-8" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg">{season.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {getClubName(season.clubId)}
                        </p>
                        {season.isActive && (
                          <Badge className="bg-green-100 text-green-800 mt-2">
                            Active Season
                          </Badge>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" data-testid={`season-menu-${season.id}`}>
                        <SettingsIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Start Date</span>
                        <span className="font-semibold text-foreground">
                          {new Date(season.startDate).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">End Date</span>
                        <span className="font-semibold text-foreground">
                          {season.endDate ? new Date(season.endDate).toLocaleDateString() : 'Ongoing'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Tournaments</span>
                        <span className="font-semibold text-foreground">0</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Players</span>
                        <span className="font-semibold text-foreground">0</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border space-y-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full justify-start"
                        data-testid={`view-leaderboard-${season.id}`}
                      >
                        <Trophy className="w-4 h-4 mr-2" />
                        View Leaderboard
                      </Button>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          data-testid={`view-season-${season.id}`}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          data-testid={`settings-season-${season.id}`}
                        >
                          <SettingsIcon className="w-4 h-4 mr-1" />
                          Settings
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateSeasonModal 
        open={showCreateSeason} 
        onOpenChange={setShowCreateSeason}
      />
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Calendar, Users } from "lucide-react";

interface Club {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

interface Tournament {
  id: string;
  name: string;
  clubId: string;
  startDateTime: string;
  status: string;
  maxPlayers: number;
}

export default function PublicHome() {
  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  const { data: tournaments = [] } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const upcomingTournaments = tournaments
    .filter(t => t.status === 'scheduled' || t.status === 'registration')
    .sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime())
    .slice(0, 6);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-gradient-to-br from-primary via-primary to-accent border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
          <div className="text-center text-white">
            <Trophy className="w-16 h-16 mx-auto mb-4" />
            <h1 className="text-3xl md:text-5xl font-bold mb-4">LovePoker.club</h1>
            <p className="text-xl md:text-2xl opacity-90">Where Poker Communities Thrive</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        {/* Upcoming Tournaments */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            Upcoming Tournaments
          </h2>
          {upcomingTournaments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No upcoming tournaments at the moment</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {upcomingTournaments.map((tournament) => (
                <Link key={tournament.id} href={`/tournament/${tournament.id}`}>
                  <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                    <CardContent className="p-6">
                      <h3 className="font-bold text-lg mb-2">{tournament.name}</h3>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          {new Date(tournament.startDateTime).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </div>
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          {tournament.maxPlayers} max players
                        </div>
                      </div>
                      <Button className="w-full mt-4" size="sm">
                        View Details
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Poker Clubs */}
        <section>
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-primary" />
            Poker Clubs
          </h2>
          {clubs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No clubs available yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {clubs.map((club) => (
                <Link key={club.id} href={`/club/${club.id}`}>
                  <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                    <CardHeader>
                      {club.imageUrl ? (
                        <img
                          src={club.imageUrl}
                          alt={club.name}
                          className="w-full h-32 object-cover rounded-lg mb-4"
                        />
                      ) : (
                        <div className="w-full h-32 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center mb-4">
                          <Trophy className="w-12 h-12 text-white" />
                        </div>
                      )}
                      <CardTitle>{club.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {club.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2"
                           dangerouslySetInnerHTML={{ __html: club.description.substring(0, 100) + '...' }}
                        />
                      )}
                      <Button className="w-full mt-4" size="sm" variant="outline">
                        View Club
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <footer className="mt-12 border-t border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} LovePoker.club - Where Poker Communities Thrive
          </p>
        </div>
      </footer>
    </div>
  );
}

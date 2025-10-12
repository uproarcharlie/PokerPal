import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tournament } from "@shared/schema";

interface Club {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string;
  description?: string;
}

export function QRCodePage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", tournamentId],
  });

  const { data: club, isLoading: clubLoading } = useQuery<Club>({
    queryKey: [`/api/clubs/${tournament?.clubId}`],
    enabled: !!tournament?.clubId,
  });

  const isLoading = tournamentLoading || clubLoading;

  const registrationUrl = `${window.location.origin}/register/${tournamentId}`;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Tournament not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center space-y-4">
          {club && (
            <Link href={`/club/${club.slug}`}>
              <div className="flex items-center justify-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
                {club.imageUrl ? (
                  <img
                    src={club.imageUrl}
                    alt={club.name}
                    className="w-20 h-20 rounded-lg object-cover border-2 border-primary/20"
                  />
                ) : (
                  <div className="w-20 h-20 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center text-white text-2xl font-bold border-2 border-primary/20">
                    {club.name.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="text-left">
                  <p className="text-3xl font-bold text-primary">{club.name}</p>
                  <p className="text-sm text-muted-foreground">Poker Club</p>
                </div>
              </div>
            </Link>
          )}
          <div className="pt-2">
            <CardTitle className="text-2xl">{tournament.name}</CardTitle>
            <CardDescription className="text-base mt-1">
              {new Date(tournament.startDateTime).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center p-8 bg-white rounded-lg shadow-inner">
            <QRCodeSVG
              value={registrationUrl}
              size={400}
              level="H"
              includeMargin={true}
            />
          </div>

          <div className="text-center space-y-2">
            <p className="text-xl font-bold text-primary">Scan to Register</p>
            <p className="text-sm text-muted-foreground">
              Players can scan this QR code to register for the tournament
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Buy-in</p>
              <p className="text-3xl font-bold text-primary">${parseFloat(tournament.buyInAmount).toFixed(2)}</p>
            </div>
            {tournament.enableHighHand && (
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">High Hand</p>
                <p className="text-3xl font-bold text-accent">
                  ${parseFloat(tournament.highHandAmount || "0").toFixed(2)}
                </p>
              </div>
            )}
          </div>

          <div className="bg-muted p-4 rounded-lg border border-border">
            <p className="text-xs font-semibold mb-2 text-muted-foreground">Registration URL</p>
            <code className="text-xs break-all text-foreground/80">{registrationUrl}</code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

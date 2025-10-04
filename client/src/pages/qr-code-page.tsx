import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tournament } from "@shared/schema";

export function QRCodePage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();

  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", tournamentId],
  });

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
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">{tournament.name}</CardTitle>
          <CardDescription className="text-lg">Self-Registration QR Code</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center p-8 bg-white rounded-lg">
            <QRCodeSVG
              value={registrationUrl}
              size={400}
              level="H"
              includeMargin={true}
            />
          </div>
          
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold">Scan to Register</p>
            <p className="text-sm text-muted-foreground">
              Players can scan this QR code with their phone camera to register for the tournament
            </p>
          </div>

          <div className="bg-muted p-4 rounded-lg">
            <p className="text-xs font-medium mb-2">Registration URL</p>
            <code className="text-xs break-all">{registrationUrl}</code>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Buy-in</p>
              <p className="text-2xl font-bold">${parseFloat(tournament.buyInAmount).toFixed(2)}</p>
            </div>
            {tournament.enableHighHand && (
              <div className="text-center">
                <p className="text-sm text-muted-foreground">High Hands</p>
                <p className="text-2xl font-bold">
                  ${parseFloat(tournament.highHandAmount || "0").toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

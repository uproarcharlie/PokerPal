import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, Clock, Trophy, QrCode, Check } from "lucide-react";
import type { Tournament } from "@shared/schema";

interface PendingRegistration {
  id: string;
  tournamentId: string;
  playerId: string;
  registrationTime: string;
  enteringHighHands: boolean;
  paymentConfirmed: boolean;
  player: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  amountOwed: number;
}

interface ConfirmedRegistration {
  id: string;
  tournamentId: string;
  playerId: string;
  registrationTime: string;
  enteringHighHands: boolean;
  paymentConfirmed: boolean;
  player: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  amountPaid: number;
}

export function AdminRegistrationsPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { toast } = useToast();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", tournamentId],
  });

  const { data: pendingRegistrations = [], refetch } = useQuery<PendingRegistration[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pending-registrations`],
    refetchInterval: 3000,
  });

  const { data: confirmedRegistrations = [], refetch: refetchConfirmed } = useQuery<ConfirmedRegistration[]>({
    queryKey: [`/api/tournaments/${tournamentId}/confirmed-registrations`],
    refetchInterval: 3000,
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const response = await apiRequest("PATCH", `/api/registrations/${registrationId}/confirm-payment`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pending-registrations`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/confirmed-registrations`] });
      toast({
        title: "Payment Confirmed",
        description: "Registration payment has been confirmed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to confirm payment. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
      refetchConfirmed();
    }, 3000);

    return () => clearInterval(interval);
  }, [refetch, refetchConfirmed]);

  if (tournamentLoading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Loading tournament...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Tournament not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const registrationUrl = `${window.location.origin}/register/${tournamentId}`;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{tournament.name}</CardTitle>
              <CardDescription>Pending Payment Confirmations</CardDescription>
            </div>
            <Button
              onClick={() => window.open(`/admin/qr/${tournamentId}`, '_blank')}
              variant="outline"
              data-testid="view-qr-code"
            >
              <QrCode className="w-4 h-4 mr-2" />
              Show QR Code
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 p-4 bg-muted rounded-lg">
            <p className="text-sm font-medium mb-2">Registration Link</p>
            <div className="flex items-center space-x-2">
              <code className="flex-1 p-2 bg-background rounded text-xs overflow-x-auto">
                {registrationUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(registrationUrl);
                  toast({
                    title: "Copied!",
                    description: "Registration link copied to clipboard.",
                  });
                }}
                data-testid="copy-registration-link"
              >
                Copy
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            {pendingRegistrations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No pending registrations</p>
                <p className="text-sm">New registrations will appear here automatically</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>High Hands</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRegistrations.map((registration) => (
                    <TableRow key={registration.id} data-testid={`registration-${registration.id}`}>
                      <TableCell className="font-medium">
                        {registration.player?.name || "Unknown Player"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {registration.player?.phone || "N/A"}
                      </TableCell>
                      <TableCell>
                        {registration.enteringHighHands ? (
                          <Badge variant="secondary">
                            <Trophy className="w-3 h-3 mr-1" />
                            Yes
                          </Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold text-lg">
                        ${registration.amountOwed.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(registration.registrationTime).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          onClick={() => confirmPaymentMutation.mutate(registration.id)}
                          disabled={confirmPaymentMutation.isPending}
                          size="sm"
                          data-testid={`confirm-payment-${registration.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Confirm Payment
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {pendingRegistrations.length > 0 && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Total Pending</p>
                  <p className="text-2xl font-bold">
                    ${pendingRegistrations.reduce((sum, reg) => sum + reg.amountOwed, 0).toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">{pendingRegistrations.length} player(s)</p>
                  <p className="text-xs text-muted-foreground">awaiting confirmation</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Confirmed Players</CardTitle>
          <CardDescription>Players who have paid and are registered</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            {confirmedRegistrations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No confirmed players yet</p>
                <p className="text-sm">Confirmed players will appear here</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>High Hands</TableHead>
                    <TableHead>Amount Paid</TableHead>
                    <TableHead>Registered At</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {confirmedRegistrations.map((registration) => (
                    <TableRow key={registration.id} data-testid={`confirmed-registration-${registration.id}`}>
                      <TableCell className="font-medium">
                        {registration.player?.name || "Unknown Player"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {registration.player?.phone || "N/A"}
                      </TableCell>
                      <TableCell>
                        {registration.enteringHighHands ? (
                          <Badge variant="secondary">
                            <Trophy className="w-3 h-3 mr-1" />
                            Yes
                          </Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold text-lg">
                        ${registration.amountPaid.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(registration.registrationTime).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-green-100 text-green-800">
                          <Check className="w-3 h-3 mr-1" />
                          Confirmed
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {confirmedRegistrations.length > 0 && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-900">Total Collected</p>
                  <p className="text-2xl font-bold text-green-900">
                    ${confirmedRegistrations.reduce((sum, reg) => sum + reg.amountPaid, 0).toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-green-700">{confirmedRegistrations.length} player(s)</p>
                  <p className="text-xs text-green-600">confirmed and paid</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Auto-Refresh</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <p className="text-sm text-muted-foreground">
              This page updates automatically every 3 seconds
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

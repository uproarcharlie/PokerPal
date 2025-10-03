import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Eye, Edit, RotateCcw, Users } from "lucide-react";

interface TournamentRegistration {
  id: string;
  tournamentId: string;
  playerId: string;
  buyIns: number;
  rebuys: number;
  addons: number;
  finalPosition?: number;
  prizeAmount?: string;
  pointsAwarded?: number;
  isEliminated: boolean;
  eliminationTime?: string;
  player: {
    id: string;
    name: string;
    email?: string;
  } | null;
}

interface StandingsTableProps {
  tournamentId: string;
  registrations: TournamentRegistration[];
  isLoading: boolean;
  onRegisterPlayer: () => void;
}

export function StandingsTable({ 
  tournamentId, 
  registrations, 
  isLoading, 
  onRegisterPlayer 
}: StandingsTableProps) {
  const { toast } = useToast();
  
  const eliminatePlayerMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const response = await apiRequest("PUT", `/api/registrations/${registrationId}`, {
        isEliminated: true,
        eliminationTime: new Date().toISOString()
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      toast({
        title: "Success",
        description: "Player eliminated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to eliminate player",
        variant: "destructive",
      });
    },
  });

  const restorePlayerMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const response = await apiRequest("PUT", `/api/registrations/${registrationId}`, {
        isEliminated: false,
        eliminationTime: null
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      toast({
        title: "Success",
        description: "Player restored successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore player",
        variant: "destructive",
      });
    },
  });

  const handleEliminate = (registrationId: string) => {
    eliminatePlayerMutation.mutate(registrationId);
  };

  const handleRestore = (registrationId: string) => {
    restorePlayerMutation.mutate(registrationId);
  };

  const getPlayerInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const getPositionDisplay = (index: number, isEliminated: boolean) => {
    if (isEliminated) {
      return index + 1;
    }
    return index + 1;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-muted rounded w-48"></div>
            <div className="h-4 bg-muted rounded w-64"></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-muted rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort registrations: active players first, then eliminated
  const sortedRegistrations = [...registrations].sort((a, b) => {
    if (a.isEliminated && !b.isEliminated) return 1;
    if (!a.isEliminated && b.isEliminated) return -1;
    return 0;
  });

  return (
    <Card>
      <CardHeader className="border-b border-border flex flex-row items-center justify-between">
        <div>
          <CardTitle>Current Standings</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Live player rankings and eliminations</p>
        </div>
        <Button onClick={onRegisterPlayer} data-testid="add-player-button">
          <UserPlus className="w-4 h-4 mr-2" />
          Add Player
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {registrations.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Players Registered</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Register players to start tracking tournament standings and eliminations.
            </p>
            <Button onClick={onRegisterPlayer} data-testid="register-first-player">
              <UserPlus className="w-4 h-4 mr-2" />
              Register First Player
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Place</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Entry</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Points</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Prize</th>
                  <th className="text-right py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedRegistrations.map((registration, index) => {
                  const position = getPositionDisplay(index, registration.isEliminated);
                  const isFirst = index === 0 && !registration.isEliminated;
                  
                  return (
                    <tr 
                      key={registration.id} 
                      className={`hover:bg-muted/20 transition-colors ${registration.isEliminated ? 'bg-muted/10' : ''}`}
                      data-testid={`player-row-${registration.id}`}
                    >
                      <td className="py-4 px-6">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          isFirst ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          {position}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                            {registration.player ? getPlayerInitials(registration.player.name) : '??'}
                          </div>
                          <div>
                            <p className={`font-medium ${registration.isEliminated ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                              {registration.player?.name || 'Unknown Player'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Buy-in: {registration.buyIns}
                              {registration.rebuys > 0 && ` + ${registration.rebuys} Re-buy${registration.rebuys > 1 ? 's' : ''}`}
                              {registration.addons > 0 && ` + ${registration.addons} Add-on${registration.addons > 1 ? 's' : ''}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <Badge className={registration.isEliminated ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}>
                          <span className="w-1.5 h-1.5 bg-current rounded-full mr-1.5"></span>
                          {registration.isEliminated ? 'Eliminated' : 'Active'}
                        </Badge>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-sm text-muted-foreground">
                          {registration.buyIns + registration.rebuys + registration.addons} entries
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-sm font-semibold text-foreground">
                          {registration.pointsAwarded || 0}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`text-sm font-semibold ${registration.prizeAmount ? 'text-accent' : 'text-muted-foreground'}`}>
                          {registration.prizeAmount ? `$${registration.prizeAmount}` : '-'}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" data-testid={`edit-player-${registration.id}`}>
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          {registration.isEliminated ? (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleRestore(registration.id)}
                              disabled={restorePlayerMutation.isPending}
                              data-testid={`restore-player-${registration.id}`}
                            >
                              <RotateCcw className="w-4 h-4 mr-1" />
                              Restore
                            </Button>
                          ) : (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleEliminate(registration.id)}
                              disabled={eliminatePlayerMutation.isPending}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              data-testid={`eliminate-player-${registration.id}`}
                            >
                              Eliminate
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
        )}
      </CardContent>
    </Card>
  );
}

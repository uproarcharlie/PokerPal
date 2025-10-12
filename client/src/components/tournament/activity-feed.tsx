import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, UserPlus, UserX, DollarSign, PlusCircle, PlayCircle, Square, CheckCircle, RotateCcw, Trophy, Lock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ActivityLog {
  id: string;
  tournamentId: string;
  playerId?: string;
  eventType: string;
  eventData?: string;
  description: string;
  timestamp: string;
  player?: {
    id: string;
    name: string;
  } | null;
}

interface ActivityFeedProps {
  tournamentId: string;
}

export function ActivityFeed({ tournamentId }: ActivityFeedProps) {
  const { data: activities = [], isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/tournaments", tournamentId, "activity"],
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'registration':
        return <UserPlus className="w-4 h-4 text-blue-600" />;
      case 'elimination':
        return <UserX className="w-4 h-4 text-red-600" />;
      case 'rebuy':
        return <DollarSign className="w-4 h-4 text-green-600" />;
      case 'addon':
        return <PlusCircle className="w-4 h-4 text-purple-600" />;
      case 'status_change':
        return <PlayCircle className="w-4 h-4 text-orange-600" />;
      case 'payment_confirmed':
        return <CheckCircle className="w-4 h-4 text-emerald-600" />;
      case 'player_restored':
        return <RotateCcw className="w-4 h-4 text-cyan-600" />;
      case 'high_hand':
        return <Trophy className="w-4 h-4 text-amber-600" />;
      case 'prize_pool_locked':
        return <Lock className="w-4 h-4 text-indigo-600" />;
      default:
        return <Activity className="w-4 h-4 text-gray-600" />;
    }
  };

  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'registration':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'elimination':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'rebuy':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'addon':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'status_change':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'payment_confirmed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'player_restored':
        return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      case 'high_hand':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'prize_pool_locked':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getEventLabel = (eventType: string) => {
    switch (eventType) {
      case 'registration':
        return 'Registration';
      case 'elimination':
        return 'Elimination';
      case 'rebuy':
        return 'Re-buy';
      case 'addon':
        return 'Add-on';
      case 'status_change':
        return 'Status Change';
      case 'payment_confirmed':
        return 'Payment';
      case 'player_restored':
        return 'Restored';
      case 'high_hand':
        return 'High Hand';
      case 'prize_pool_locked':
        return 'Pool Locked';
      default:
        return 'Event';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Activity Feed
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-8 h-8 bg-muted rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Activity Feed
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">Real-time tournament events</p>
      </CardHeader>
      <CardContent className="p-6">
        {activities.length === 0 ? (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground mt-1">Events will appear here as they happen</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 pb-4 border-b border-border last:border-0 last:pb-0"
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  {getEventIcon(activity.eventType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge className={`${getEventColor(activity.eventType)} text-xs`}>
                      {getEventLabel(activity.eventType)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{activity.description}</p>
                  {activity.player && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Player: {activity.player.name}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

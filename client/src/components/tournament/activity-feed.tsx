import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReactNode } from "react";
import {
  Activity,
  UserPlus,
  UserMinus,
  UserX,
  DollarSign,
  PlusCircle,
  PlayCircle,
  CheckCircle,
  RotateCcw,
  Trophy,
  Lock,
  Calculator,
  Percent,
  ListOrdered,
  Swords,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ACTIVITY_EVENT_TYPES, type ActivityEventType } from "@shared/api/tournaments";

interface EventStyle {
  icon: ReactNode;
  color: string;
  label: string;
}

/** How every event the server writes is shown; a Record, so a new event type cannot be left out (P2REV4-CQ-07). */
const EVENT_STYLES: Readonly<Record<ActivityEventType, EventStyle>> = {
  registration: { icon: <UserPlus className="w-4 h-4 text-blue-600" />, color: "bg-blue-100 text-blue-800 border-blue-200", label: "Registration" },
  registration_removed: {
    icon: <UserMinus className="w-4 h-4 text-slate-600" />,
    color: "bg-slate-100 text-slate-800 border-slate-200",
    label: "Entry Removed",
  },
  elimination: { icon: <UserX className="w-4 h-4 text-red-600" />, color: "bg-red-100 text-red-800 border-red-200", label: "Elimination" },
  knockout_credited: { icon: <Swords className="w-4 h-4 text-red-600" />, color: "bg-red-50 text-red-800 border-red-200", label: "Knockout" },
  player_restored: { icon: <RotateCcw className="w-4 h-4 text-cyan-600" />, color: "bg-cyan-100 text-cyan-800 border-cyan-200", label: "Restored" },
  rebuy: { icon: <DollarSign className="w-4 h-4 text-green-600" />, color: "bg-green-100 text-green-800 border-green-200", label: "Re-buy" },
  addon: { icon: <PlusCircle className="w-4 h-4 text-purple-600" />, color: "bg-purple-100 text-purple-800 border-purple-200", label: "Add-on" },
  reentry: { icon: <RotateCcw className="w-4 h-4 text-cyan-600" />, color: "bg-cyan-100 text-cyan-800 border-cyan-200", label: "Re-entry" },
  payment_confirmed: {
    icon: <CheckCircle className="w-4 h-4 text-emerald-600" />,
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    label: "Payment",
  },
  high_hand: { icon: <Trophy className="w-4 h-4 text-amber-600" />, color: "bg-amber-100 text-amber-800 border-amber-200", label: "High Hand" },
  status_change: {
    icon: <PlayCircle className="w-4 h-4 text-orange-600" />,
    color: "bg-orange-100 text-orange-800 border-orange-200",
    label: "Status Change",
  },
  prize_pool_locked: { icon: <Lock className="w-4 h-4 text-indigo-600" />, color: "bg-indigo-100 text-indigo-800 border-indigo-200", label: "Pool Locked" },
  prize_pool_adjusted: {
    icon: <Calculator className="w-4 h-4 text-teal-600" />,
    color: "bg-teal-100 text-teal-800 border-teal-200",
    label: "Prize Pool",
  },
  rake_rates_changed: { icon: <Percent className="w-4 h-4 text-teal-600" />, color: "bg-teal-100 text-teal-800 border-teal-200", label: "Rates" },
  tournament_refinalized: {
    icon: <ListOrdered className="w-4 h-4 text-orange-600" />,
    color: "bg-orange-100 text-orange-800 border-orange-200",
    label: "Results Corrected",
  },
};

/** Rows written before Phase 2 may hold an event type the app no longer writes. */
const OTHER_EVENT: EventStyle = { icon: <Activity className="w-4 h-4 text-gray-600" />, color: "bg-gray-100 text-gray-800 border-gray-200", label: "Event" };

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(ACTIVITY_EVENT_TYPES);

function eventStyle(eventType: string): EventStyle {
  return KNOWN_EVENT_TYPES.has(eventType) ? EVENT_STYLES[eventType as ActivityEventType] : OTHER_EVENT;
}

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
                  {eventStyle(activity.eventType).icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge className={`${eventStyle(activity.eventType).color} text-xs`}>
                      {eventStyle(activity.eventType).label}
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

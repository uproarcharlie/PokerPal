import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InfoIcon, Check, Save } from "lucide-react";

const tournamentSchema = z.object({
  name: z.string().min(1, "Tournament name is required"),
  description: z.string().optional(),
  clubId: z.string().min(1, "Club selection is required"),
  seasonId: z.string().optional(),
  startDateTime: z.string().min(1, "Start date and time is required"),
  buyInAmount: z.string().min(1, "Buy-in amount is required").regex(/^\d+(\.\d{2})?$/, "Invalid amount format"),
  rebuyAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  addonAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  maxRebuys: z.string().regex(/^\d*$/, "Must be a number").optional(),
  rebuyPeriodMinutes: z.string().regex(/^\d*$/, "Must be a number").optional(),
  rakeType: z.enum(["none", "percentage", "fixed"]),
  rakeAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  payoutStructure: z.enum(["standard", "top3", "top5", "custom"]),
  enableHighHand: z.boolean().default(false),
  highHandAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  enableLateRegistration: z.boolean().default(false),
  trackPoints: z.boolean().default(true),
  minPlayers: z.string().regex(/^\d*$/, "Must be a number").optional(),
  maxPlayers: z.string().min(1, "Maximum players is required").regex(/^\d+$/, "Must be a positive number"),
});

type TournamentFormData = z.infer<typeof tournamentSchema>;

interface Club {
  id: string;
  name: string;
}

interface Season {
  id: string;
  name: string;
  clubId: string;
}

interface CreateTournamentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTournamentModal({ open, onOpenChange }: CreateTournamentModalProps) {
  const [isDraft, setIsDraft] = useState(false);
  const { toast } = useToast();

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  const { data: seasons = [] } = useQuery<Season[]>({
    queryKey: ["/api/seasons"],
  });

  const form = useForm<TournamentFormData>({
    resolver: zodResolver(tournamentSchema),
    defaultValues: {
      name: "",
      description: "",
      clubId: "",
      seasonId: "",
      startDateTime: "",
      buyInAmount: "",
      rebuyAmount: "",
      addonAmount: "",
      maxRebuys: "",
      rebuyPeriodMinutes: "60",
      rakeType: "none",
      rakeAmount: "",
      payoutStructure: "standard",
      enableHighHand: false,
      highHandAmount: "",
      enableLateRegistration: false,
      trackPoints: true,
      minPlayers: "8",
      maxPlayers: "",
    },
  });

  const selectedClubId = form.watch("clubId");
  const filteredSeasons = seasons.filter(season => season.clubId === selectedClubId);

  const createTournamentMutation = useMutation({
    mutationFn: async (data: TournamentFormData) => {
      const payload = {
        ...data,
        buyInAmount: parseFloat(data.buyInAmount),
        rebuyAmount: data.rebuyAmount ? parseFloat(data.rebuyAmount) : null,
        addonAmount: data.addonAmount ? parseFloat(data.addonAmount) : null,
        maxRebuys: data.maxRebuys ? parseInt(data.maxRebuys) : null,
        rebuyPeriodMinutes: data.rebuyPeriodMinutes ? parseInt(data.rebuyPeriodMinutes) : null,
        rakeAmount: data.rakeAmount ? parseFloat(data.rakeAmount) : 0,
        highHandAmount: data.highHandAmount ? parseFloat(data.highHandAmount) : null,
        minPlayers: data.minPlayers ? parseInt(data.minPlayers) : 8,
        maxPlayers: parseInt(data.maxPlayers),
        status: isDraft ? "scheduled" : "registration",
        seasonId: data.seasonId || null,
      };

      const response = await apiRequest("POST", "/api/tournaments", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: `Tournament ${isDraft ? "saved as draft" : "created"} successfully!`,
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create tournament",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TournamentFormData) => {
    createTournamentMutation.mutate(data);
  };

  const handleSaveAsDraft = () => {
    setIsDraft(true);
    form.handleSubmit(onSubmit)();
  };

  const handleCreate = () => {
    setIsDraft(false);
    form.handleSubmit(onSubmit)();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Create New Tournament</DialogTitle>
          <DialogDescription>
            Set up your tournament details and configuration
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="flex-1 overflow-y-auto space-y-6 px-1">
            {/* Basic Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Basic Information
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tournament Name*</FormLabel>
                      <FormControl>
                        <Input placeholder="Friday Night Series #13" {...field} data-testid="tournament-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="clubId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Club*</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="club-select">
                            <SelectValue placeholder="Select a club" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {clubs.length === 0 ? (
                            <SelectItem value="no-clubs" disabled>No clubs available</SelectItem>
                          ) : (
                            clubs.map((club) => (
                              <SelectItem key={club.id} value={club.id}>
                                {club.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="seasonId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Season</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!selectedClubId}>
                        <FormControl>
                          <SelectTrigger data-testid="season-select">
                            <SelectValue placeholder="Select a season" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {filteredSeasons.length === 0 ? (
                            <SelectItem value="no-seasons" disabled>
                              {selectedClubId ? "No seasons available for this club" : "Select a club first"}
                            </SelectItem>
                          ) : (
                            filteredSeasons.map((season) => (
                              <SelectItem key={season.id} value={season.id}>
                                {season.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="startDateTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date & Time*</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="start-datetime" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="Add tournament details, rules, or special notes..."
                        className="resize-none"
                        {...field}
                        data-testid="tournament-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Buy-in Configuration */}
            <div className="space-y-4 pt-6 border-t border-border">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Buy-in Configuration
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="buyInAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Buy-in Amount*</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input className="pl-8" placeholder="100" {...field} data-testid="buyin-amount" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="rebuyAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Re-buy Amount</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input className="pl-8" placeholder="50" {...field} data-testid="rebuy-amount" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="addonAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Add-on Amount</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input className="pl-8" placeholder="25" {...field} data-testid="addon-amount" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="maxRebuys"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Re-buys</FormLabel>
                      <FormControl>
                        <Input placeholder="3" {...field} data-testid="max-rebuys" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="rebuyPeriodMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Re-buy Period (minutes)</FormLabel>
                      <FormControl>
                        <Input placeholder="60" {...field} data-testid="rebuy-period" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Prize Pool Settings */}
            <div className="space-y-4 pt-6 border-t border-border">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Prize Pool Settings
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="rakeType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rake Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="rake-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="percentage">Percentage (%)</SelectItem>
                          <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                          <SelectItem value="none">No Rake</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="rakeAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rake Amount</FormLabel>
                      <FormControl>
                        <Input placeholder="10" {...field} data-testid="rake-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="payoutStructure"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payout Structure</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="payout-structure">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="standard">Standard (50/30/20)</SelectItem>
                        <SelectItem value="top3">Top 3 (60/25/15)</SelectItem>
                        <SelectItem value="top5">Top 5 (40/25/18/10/7)</SelectItem>
                        <SelectItem value="custom">Custom Distribution</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Additional Options */}
            <div className="space-y-4 pt-6 border-t border-border">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Additional Options
              </h4>
              
              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="enableHighHand"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="enable-high-hand"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm font-medium">Enable High Hand Bonus</FormLabel>
                        <FormDescription>
                          Award a bonus for the highest poker hand during the tournament
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="enableLateRegistration"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="enable-late-registration"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm font-medium">Enable Late Registration</FormLabel>
                        <FormDescription>
                          Allow players to join after the tournament has started
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="trackPoints"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="track-points"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm font-medium">Track Player Points</FormLabel>
                        <FormDescription>
                          Assign points to players based on their final placement
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              {form.watch("enableHighHand") && (
                <FormField
                  control={form.control}
                  name="highHandAmount"
                  render={({ field }) => (
                    <FormItem className="ml-6">
                      <FormLabel>High Hand Amount</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input className="pl-8" placeholder="100" {...field} data-testid="high-hand-amount" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <Alert>
                <InfoIcon className="h-4 w-4" />
                <AlertDescription>
                  <strong>High Hand Bonus:</strong> When enabled, you can set a separate prize pool amount that will be awarded to the player with the highest qualifying hand during the tournament.
                </AlertDescription>
              </Alert>
            </div>

            {/* Player Limits */}
            <div className="space-y-4 pt-6 border-t border-border">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Player Limits
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="minPlayers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Players</FormLabel>
                      <FormControl>
                        <Input placeholder="8" {...field} data-testid="min-players" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="maxPlayers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Players*</FormLabel>
                      <FormControl>
                        <Input placeholder="50" {...field} data-testid="max-players" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </form>
        </Form>

        <DialogFooter className="shrink-0 border-t border-border pt-6">
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            data-testid="cancel-tournament"
          >
            Cancel
          </Button>
          <Button 
            type="button" 
            variant="secondary"
            onClick={handleSaveAsDraft}
            disabled={createTournamentMutation.isPending}
            data-testid="save-draft-tournament"
          >
            <Save className="w-4 h-4 mr-2" />
            Save as Draft
          </Button>
          <Button 
            type="button"
            onClick={handleCreate}
            disabled={createTournamentMutation.isPending}
            data-testid="create-tournament-final"
          >
            <Check className="w-4 h-4 mr-2" />
            {createTournamentMutation.isPending ? "Creating..." : "Create Tournament"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

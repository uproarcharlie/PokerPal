import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FormSlideout } from "@/components/ui/form-slideout";
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
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ImageUpload } from "@/components/ui/image-upload";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InfoIcon, Check, Save } from "lucide-react";

const tournamentSchema = z.object({
  name: z.string().min(1, "Tournament name is required"),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  clubId: z.string().min(1, "Club selection is required"),
  seasonId: z.string().optional(),
  pointsSystemId: z.string().optional(),
  startDateTime: z.string().min(1, "Start date and time is required"),
  buyInAmount: z.string().min(1, "Buy-in amount is required").regex(/^\d+(\.\d{2})?$/, "Invalid amount format"),
  enableRebuys: z.boolean().default(false),
  rebuyAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  maxRebuys: z.string().regex(/^\d*$/, "Must be a number").optional(),
  rebuyPeriodMinutes: z.string().regex(/^\d*$/, "Must be a number").optional(),
  rebuyRakeType: z.enum(["none", "percentage", "fixed"]),
  rebuyRakeAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  enableAddons: z.boolean().default(false),
  addonAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  addonRakeType: z.enum(["none", "percentage", "fixed"]),
  addonRakeAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  rakeType: z.enum(["none", "percentage", "fixed"]),
  rakeAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  payoutStructure: z.enum(["standard", "top3", "top5", "top8", "top9", "custom"]),
  enableHighHand: z.boolean().default(false),
  highHandAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  highHandRakeType: z.enum(["none", "percentage", "fixed"]),
  highHandRakeAmount: z.string().regex(/^(\d+(\.\d{2})?)?$/, "Invalid amount format").optional(),
  highHandPayouts: z.string().regex(/^[1-4]$/, "Must be between 1 and 4").optional(),
  enableLateRegistration: z.boolean().default(false),
  trackPoints: z.boolean().default(true),
  minPlayers: z.string().regex(/^\d*$/, "Must be a number").optional(),
  maxPlayers: z.string().min(1, "Maximum players is required").regex(/^\d+$/, "Must be a positive number"),
  useClubAddress: z.boolean().default(true),
  address: z.string().optional(),
});

type TournamentFormData = z.infer<typeof tournamentSchema>;

interface Club {
  id: string;
  name: string;
  address?: string;
  timezone?: string;
}

interface Season {
  id: string;
  name: string;
  clubId: string;
}

interface PointsSystem {
  id: string;
  seasonId: string;
  name: string;
  description: string | null;
  participationPoints: number | null;
  knockoutPoints: number | null;
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
      imageUrl: "",
      clubId: "",
      seasonId: "",
      pointsSystemId: "",
      startDateTime: "",
      buyInAmount: "",
      enableRebuys: false,
      rebuyAmount: "",
      maxRebuys: "",
      rebuyPeriodMinutes: "60",
      rebuyRakeType: "none",
      rebuyRakeAmount: "",
      enableAddons: false,
      addonAmount: "",
      addonRakeType: "none",
      addonRakeAmount: "",
      rakeType: "none",
      rakeAmount: "",
      payoutStructure: "standard",
      enableHighHand: false,
      highHandAmount: "",
      highHandRakeType: "none",
      highHandRakeAmount: "",
      highHandPayouts: "1",
      enableLateRegistration: false,
      trackPoints: true,
      minPlayers: "8",
      maxPlayers: "",
      useClubAddress: true,
      address: "",
    },
  });

  const selectedClubId = form.watch("clubId");
  const selectedSeasonId = form.watch("seasonId");
  const filteredSeasons = seasons.filter(season => season.clubId === selectedClubId);

  // Fetch points systems for the selected season
  const { data: pointsSystems = [] } = useQuery<PointsSystem[]>({
    queryKey: [`/api/seasons/${selectedSeasonId}/points-systems`],
    enabled: !!selectedSeasonId,
  });

  // Reset pointsSystemId when season changes
  useEffect(() => {
    form.setValue("pointsSystemId", "");
  }, [selectedSeasonId, form]);

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
        rebuyRakeAmount: data.rebuyRakeAmount ? parseFloat(data.rebuyRakeAmount) : 0,
        addonRakeAmount: data.addonRakeAmount ? parseFloat(data.addonRakeAmount) : 0,
        highHandAmount: data.highHandAmount ? parseFloat(data.highHandAmount) : null,
        highHandRakeAmount: data.highHandRakeAmount ? parseFloat(data.highHandRakeAmount) : 0,
        highHandPayouts: data.highHandPayouts ? parseInt(data.highHandPayouts) : 1,
        minPlayers: data.minPlayers ? parseInt(data.minPlayers) : 8,
        maxPlayers: parseInt(data.maxPlayers),
        status: isDraft ? "scheduled" : "registration",
        seasonId: data.seasonId || null,
        pointsSystemId: data.pointsSystemId || null,
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
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Tournament"
      description="Set up your tournament details and configuration"
      footer={
        <>
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
        </>
      }
    >
      <Form {...form}>
        <form className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Basic Information
              </h4>

              <FormField
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tournament Image</FormLabel>
                    <FormControl>
                      <ImageUpload
                        onImageUpload={field.onChange}
                        currentImage={field.value}
                        entityType="tournaments"
                        placeholder="Upload tournament banner or image"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                  name="pointsSystemId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Points System</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!selectedSeasonId}>
                        <FormControl>
                          <SelectTrigger data-testid="points-system-select">
                            <SelectValue placeholder="Select a points system" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {pointsSystems.length === 0 ? (
                            <SelectItem value="no-points-systems" disabled>
                              {selectedSeasonId ? "No points systems available for this season" : "Select a season first"}
                            </SelectItem>
                          ) : (
                            pointsSystems.map((pointsSystem) => (
                              <SelectItem key={pointsSystem.id} value={pointsSystem.id}>
                                {pointsSystem.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Optional - Select a points system to award points based on player placement
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              </div>

              {/* Rebuy Toggle and Fields */}
              <FormField
                control={form.control}
                name="enableRebuys"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Enable Re-buys</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Allow players to re-buy during the tournament
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="enable-rebuys"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {form.watch("enableRebuys") && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

                  {/* Rebuy Rake */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <FormField
                      control={form.control}
                      name="rebuyRakeType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Re-buy Rake Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="rebuy-rake-type">
                                <SelectValue placeholder="Select rake type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">No Rake</SelectItem>
                              <SelectItem value="percentage">Percentage</SelectItem>
                              <SelectItem value="fixed">Fixed Amount</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {form.watch("rebuyRakeType") !== "none" && (
                      <FormField
                        control={form.control}
                        name="rebuyRakeAmount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Re-buy Rake Amount</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                  {form.watch("rebuyRakeType") === "percentage" ? "%" : "$"}
                                </span>
                                <Input
                                  className="pl-8"
                                  placeholder={form.watch("rebuyRakeType") === "percentage" ? "10" : "5"}
                                  {...field}
                                  data-testid="rebuy-rake-amount"
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </>
              )}

              {/* Addon Toggle and Fields */}
              <FormField
                control={form.control}
                name="enableAddons"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Enable Add-ons</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Allow players to purchase add-ons during the tournament
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="enable-addons"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {form.watch("enableAddons") && (
                <>
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

                  {/* Addon Rake */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <FormField
                      control={form.control}
                      name="addonRakeType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Add-on Rake Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="addon-rake-type">
                                <SelectValue placeholder="Select rake type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">No Rake</SelectItem>
                              <SelectItem value="percentage">Percentage</SelectItem>
                              <SelectItem value="fixed">Fixed Amount</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {form.watch("addonRakeType") !== "none" && (
                      <FormField
                        control={form.control}
                        name="addonRakeAmount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Add-on Rake Amount</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                  {form.watch("addonRakeType") === "percentage" ? "%" : "$"}
                                </span>
                                <Input
                                  className="pl-8"
                                  placeholder={form.watch("addonRakeType") === "percentage" ? "10" : "5"}
                                  {...field}
                                  data-testid="addon-rake-amount"
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </>
              )}
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
                          <SelectItem value="fixed">Per Entry ($)</SelectItem>
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
                      <FormLabel>
                        {form.watch("rakeType") === "percentage" ? "Rake Percentage" :
                         form.watch("rakeType") === "fixed" ? "Rake Per Entry" : "Rake Amount"}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          {form.watch("rakeType") === "percentage" ? (
                            <>
                              <Input placeholder="10" {...field} data-testid="rake-amount" />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </>
                          ) : form.watch("rakeType") === "fixed" ? (
                            <>
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                              <Input className="pl-8" placeholder="5" {...field} data-testid="rake-amount" />
                            </>
                          ) : (
                            <Input placeholder="0" {...field} data-testid="rake-amount" disabled />
                          )}
                        </div>
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
                        <SelectItem value="top8">Top 8 (35/22/16/11/7/5/3/1)</SelectItem>
                        <SelectItem value="top9">Top 9 (32/20/15/11/8/6/4/3/1)</SelectItem>
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
                <div className="ml-6 space-y-4 p-4 border border-border rounded-lg bg-muted/20">
                  <FormField
                    control={form.control}
                    name="highHandAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>High Hand Pool Amount</FormLabel>
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

                  <FormField
                    control={form.control}
                    name="highHandPayouts"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Number of High Hand Payouts (1-4)</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" max="4" placeholder="1" {...field} data-testid="high-hand-payouts" />
                        </FormControl>
                        <FormDescription>
                          Split the high hand pool among multiple winners
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="highHandRakeType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>High Hand Rake Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="high-hand-rake-type">
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">No Rake</SelectItem>
                            <SelectItem value="percentage">Percentage</SelectItem>
                            <SelectItem value="fixed">Fixed Amount</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {form.watch("highHandRakeType") !== "none" && (
                    <FormField
                      control={form.control}
                      name="highHandRakeAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {form.watch("highHandRakeType") === "percentage" ? "Rake Percentage" : "Rake Amount"}
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              {form.watch("highHandRakeType") === "percentage" ? (
                                <>
                                  <Input placeholder="10" {...field} data-testid="high-hand-rake-amount" />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                                </>
                              ) : (
                                <>
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                                  <Input className="pl-8" placeholder="10" {...field} data-testid="high-hand-rake-amount" />
                                </>
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              <Alert>
                <InfoIcon className="h-4 w-4" />
                <AlertDescription>
                  <strong>High Hand Bonus:</strong> When enabled, you can set a separate prize pool for high hands. Configure the pool amount, number of payouts (1-4), and optional rake. The pool will be split equally among the number of payouts.
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

              {/* Address Section */}
              <div className="space-y-4 pt-4 border-t">
                <h3 className="text-lg font-semibold">Location</h3>

                <FormField
                  control={form.control}
                  name="useClubAddress"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Use Club Address</FormLabel>
                        <FormDescription>
                          Use the address from the selected club
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {!form.watch("useClubAddress") && (
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tournament Address</FormLabel>
                        <FormControl>
                          <AddressAutocomplete
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Start typing an address..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {form.watch("useClubAddress") && selectedClubId && (
                  <div className="rounded-lg border p-3 bg-muted/50">
                    {(() => {
                      const club = clubs.find(c => c.id === selectedClubId);
                      if (club?.address) {
                        return (
                          <>
                            <p className="text-sm text-muted-foreground">
                              Address: {club.address}
                            </p>
                            {club.timezone && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Timezone: {club.timezone}
                              </p>
                            )}
                          </>
                        );
                      }
                      return <p className="text-sm text-muted-foreground">No address set for this club</p>;
                    })()}
                  </div>
                )}
              </div>
            </div>
        </form>
      </Form>
    </FormSlideout>
  );
}

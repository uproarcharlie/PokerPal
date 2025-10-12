import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, Plus, Trash2 } from "lucide-react";

const seasonSchema = z.object({
  name: z.string().min(1, "Season name is required"),
  clubId: z.string().min(1, "Club selection is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  isActive: z.boolean().default(true),
});

const pointsSystemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  participationPoints: z.string().regex(/^\d*$/, "Must be a number").optional(),
  knockoutPoints: z.string().regex(/^\d*$/, "Must be a number").optional(),
  allocations: z.array(z.object({
    position: z.string().min(1, "Position is required"),
    positionEnd: z.string().optional(),
    points: z.string().min(1, "Points is required"),
    description: z.string().optional(),
  })).optional(),
});

type SeasonFormData = z.infer<typeof seasonSchema>;
type PointsSystemFormData = z.infer<typeof pointsSystemSchema>;

interface Season {
  id: string;
  name: string;
  clubId: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
}

interface Club {
  id: string;
  name: string;
}

interface PointsSystem {
  id: string;
  seasonId: string;
  name: string;
  description?: string;
  participationPoints?: number;
  knockoutPoints?: number;
}

interface PointsAllocation {
  id: string;
  pointsSystemId: string;
  position: number;
  positionEnd?: number;
  points: number;
  description?: string;
}

export default function SeasonSettings() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [editingPointsSystem, setEditingPointsSystem] = useState<PointsSystem | null>(null);
  const [allocations, setAllocations] = useState<Array<{ position: string; positionEnd?: string; points: string; description?: string }>>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: season, isLoading: seasonLoading } = useQuery<Season>({
    queryKey: [`/api/seasons/${id}`],
  });

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  const { data: pointsSystems = [] } = useQuery<PointsSystem[]>({
    queryKey: [`/api/seasons/${id}/points-systems`],
    enabled: !!id,
  });

  const seasonForm = useForm<SeasonFormData>({
    resolver: zodResolver(seasonSchema),
    defaultValues: {
      name: "",
      clubId: "",
      startDate: "",
      endDate: "",
      isActive: true,
    },
  });

  const pointsForm = useForm<PointsSystemFormData>({
    resolver: zodResolver(pointsSystemSchema),
    defaultValues: {
      name: "",
      description: "",
      participationPoints: "0",
      knockoutPoints: "0",
    },
  });

  // Update season form values when season data loads
  useEffect(() => {
    if (season) {
      seasonForm.reset({
        name: season.name || "",
        clubId: season.clubId || "",
        startDate: season.startDate ? new Date(season.startDate).toISOString().split('T')[0] : "",
        endDate: season.endDate ? new Date(season.endDate).toISOString().split('T')[0] : "",
        isActive: season.isActive ?? true,
      });
    }
  }, [season, seasonForm]);

  const deleteSeasonMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/seasons/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/seasons"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Season deleted successfully!",
      });
      setLocation("/seasons");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete season",
        variant: "destructive",
      });
    },
  });

  const updateSeasonMutation = useMutation({
    mutationFn: async (data: SeasonFormData) => {
      const payload = {
        ...data,
        startDate: new Date(data.startDate).toISOString(),
        endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
      };

      const response = await apiRequest("PUT", `/api/seasons/${id}`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/seasons"] });
      queryClient.invalidateQueries({ queryKey: [`/api/seasons/${id}`] });
      toast({
        title: "Success",
        description: "Season updated successfully!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update season",
        variant: "destructive",
      });
    },
  });

  const createPointsSystemMutation = useMutation({
    mutationFn: async (data: PointsSystemFormData) => {
      const payload = {
        name: data.name,
        description: data.description || null,
        participationPoints: data.participationPoints ? parseInt(data.participationPoints) : 0,
        knockoutPoints: data.knockoutPoints ? parseInt(data.knockoutPoints) : 0,
      };

      const response = await apiRequest("POST", `/api/seasons/${id}/points-systems`, payload);
      const pointsSystem = await response.json();

      // Create allocations if any
      if (allocations.length > 0) {
        for (const allocation of allocations) {
          await apiRequest("POST", `/api/points-systems/${pointsSystem.id}/allocations`, {
            position: parseInt(allocation.position),
            positionEnd: allocation.positionEnd ? parseInt(allocation.positionEnd) : null,
            points: parseInt(allocation.points),
            description: allocation.description || null,
          });
        }
      }

      return pointsSystem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/seasons/${id}/points-systems`] });
      toast({
        title: "Success",
        description: "Points system created successfully!",
      });
      pointsForm.reset();
      setAllocations([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create points system",
        variant: "destructive",
      });
    },
  });

  const deletePointsSystemMutation = useMutation({
    mutationFn: async (pointsSystemId: string) => {
      await apiRequest("DELETE", `/api/points-systems/${pointsSystemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/seasons/${id}/points-systems`] });
      toast({
        title: "Success",
        description: "Points system deleted successfully!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete points system",
        variant: "destructive",
      });
    },
  });

  const onSeasonSubmit = (data: SeasonFormData) => {
    updateSeasonMutation.mutate(data);
  };

  const onPointsSubmit = (data: PointsSystemFormData) => {
    createPointsSystemMutation.mutate(data);
  };

  const addAllocation = () => {
    setAllocations([...allocations, { position: "", points: "", description: "" }]);
  };

  const removeAllocation = (index: number) => {
    setAllocations(allocations.filter((_, i) => i !== index));
  };

  const updateAllocation = (index: number, field: string, value: string) => {
    const updated = [...allocations];
    updated[index] = { ...updated[index], [field]: value };
    setAllocations(updated);
  };

  if (seasonLoading) {
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
          <div className="h-96 bg-muted rounded-lg animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (!season) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Season Not Found</h2>
          <p className="text-muted-foreground mb-6">The season you're looking for doesn't exist.</p>
          <Link href="/seasons">
            <Button>Back to Seasons</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/seasons">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <h2 className="text-2xl font-bold text-foreground">{season.name} Settings</h2>
                <p className="text-sm text-muted-foreground mt-1">Manage season settings and points systems</p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Season
            </Button>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-4xl mx-auto">
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="profile">Edit Profile</TabsTrigger>
            <TabsTrigger value="points">Points Systems</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card>
              <CardContent className="pt-6">
                <Form {...seasonForm}>
                  <form onSubmit={seasonForm.handleSubmit(onSeasonSubmit)} className="space-y-6">
                    <FormField
                      control={seasonForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Season Name*</FormLabel>
                          <FormControl>
                            <Input placeholder="Spring 2024" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={seasonForm.control}
                      name="clubId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Club*</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a club" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {clubs.map((club) => (
                                <SelectItem key={club.id} value={club.id}>
                                  {club.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={seasonForm.control}
                        name="startDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start Date*</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={seasonForm.control}
                        name="endDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>End Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={seasonForm.control}
                      name="isActive"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel>Active Season</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Mark this as the active season for the club
                            </p>
                          </div>
                        </FormItem>
                      )}
                    />

                    <div className="flex justify-end gap-3 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setLocation('/seasons')}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={updateSeasonMutation.isPending}
                      >
                        <Check className="w-4 h-4 mr-2" />
                        {updateSeasonMutation.isPending ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="points">
            <div className="space-y-6">
              {/* Existing Points Systems */}
              {pointsSystems.length > 0 && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 className="text-lg font-semibold mb-4">Existing Points Systems</h3>
                    <div className="space-y-3">
                      {pointsSystems.map((system) => (
                        <div key={system.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">{system.name}</p>
                            {system.description && (
                              <p className="text-sm text-muted-foreground">{system.description}</p>
                            )}
                            <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                              {system.participationPoints !== null && system.participationPoints > 0 && (
                                <span>Participation: {system.participationPoints} pts</span>
                              )}
                              {system.knockoutPoints !== null && system.knockoutPoints > 0 && (
                                <span>Knockout: {system.knockoutPoints} pts</span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deletePointsSystemMutation.mutate(system.id)}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Create New Points System */}
              <Card>
                <CardContent className="pt-6">
                  <h3 className="text-lg font-semibold mb-4">Create New Points System</h3>
                  <Form {...pointsForm}>
                    <form onSubmit={pointsForm.handleSubmit(onPointsSubmit)} className="space-y-6">
                      <FormField
                        control={pointsForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System Name*</FormLabel>
                            <FormControl>
                              <Input placeholder="Standard Points" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={pointsForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Input placeholder="Points awarded based on placement" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={pointsForm.control}
                          name="participationPoints"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Participation Points</FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="0" {...field} />
                              </FormControl>
                              <p className="text-xs text-muted-foreground">Points for participating</p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={pointsForm.control}
                          name="knockoutPoints"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Knockout Points</FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="0" {...field} />
                              </FormControl>
                              <p className="text-xs text-muted-foreground">Points per knockout</p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold">Position-Based Points</h4>
                          <Button type="button" variant="outline" size="sm" onClick={addAllocation}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Position
                          </Button>
                        </div>

                        {allocations.map((allocation, index) => (
                          <div key={index} className="grid grid-cols-12 gap-2 items-end">
                            <div className="col-span-3">
                              <label className="text-xs text-muted-foreground">Position</label>
                              <Input
                                type="number"
                                placeholder="1"
                                value={allocation.position}
                                onChange={(e) => updateAllocation(index, 'position', e.target.value)}
                              />
                            </div>
                            <div className="col-span-3">
                              <label className="text-xs text-muted-foreground">End (optional)</label>
                              <Input
                                type="number"
                                placeholder="3"
                                value={allocation.positionEnd || ''}
                                onChange={(e) => updateAllocation(index, 'positionEnd', e.target.value)}
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="text-xs text-muted-foreground">Points</label>
                              <Input
                                type="number"
                                placeholder="100"
                                value={allocation.points}
                                onChange={(e) => updateAllocation(index, 'points', e.target.value)}
                              />
                            </div>
                            <div className="col-span-3">
                              <label className="text-xs text-muted-foreground">Label</label>
                              <Input
                                placeholder="Winner"
                                value={allocation.description || ''}
                                onChange={(e) => updateAllocation(index, 'description', e.target.value)}
                              />
                            </div>
                            <div className="col-span-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeAllocation(index)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-end pt-4">
                        <Button
                          type="submit"
                          disabled={createPointsSystemMutation.isPending}
                        >
                          <Check className="w-4 h-4 mr-2" />
                          {createPointsSystemMutation.isPending ? "Creating..." : "Create Points System"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={() => deleteSeasonMutation.mutate()}
        title="Delete Season"
        description="Are you sure you want to delete this season? This action cannot be undone and will remove all associated tournaments, points systems, and data."
        itemName={season?.name}
        isDeleting={deleteSeasonMutation.isPending}
      />
    </div>
  );
}

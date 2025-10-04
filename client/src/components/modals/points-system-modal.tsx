import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { FormSlideout } from "@/components/ui/form-slideout";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Save, Plus, Trash2, Copy, Info } from "lucide-react";

const pointsSystemSchema = z.object({
  seasonId: z.string().min(1, "Season ID is required"),
  name: z.string().min(1, "Points system name is required"),
  description: z.string().optional(),
  participationPoints: z.string().regex(/^\d*$/, "Must be a number").optional(),
  knockoutPoints: z.string().regex(/^\d*$/, "Must be a number").optional(),
});

const pointsAllocationSchema = z.object({
  position: z.string().regex(/^\d+$/, "Must be a positive number").min(1, "Position is required"),
  positionEnd: z.string().regex(/^\d*$/, "Must be a number").optional(),
  points: z.string().regex(/^\d+$/, "Must be a positive number").min(1, "Points are required"),
  description: z.string().optional(),
});

type PointsSystemFormData = z.infer<typeof pointsSystemSchema>;
type PointsAllocationFormData = z.infer<typeof pointsAllocationSchema>;

interface PointsSystemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seasonId: string;
  seasonName?: string;
}

interface PointsAllocation {
  id: string;
  position: number;
  positionEnd?: number;
  points: number;
  description?: string;
}

export function PointsSystemModal({ open, onOpenChange, seasonId, seasonName }: PointsSystemModalProps) {
  const { toast } = useToast();
  const [allocations, setAllocations] = useState<PointsAllocation[]>([
    { id: '1', position: 1, points: 100, description: 'Winner bonus points' },
    { id: '2', position: 2, points: 75, description: 'Runner-up points' },
    { id: '3', position: 3, points: 50, description: 'Third place points' },
    { id: '4', position: 4, positionEnd: 10, points: 25, description: 'Final table points' },
  ]);

  const form = useForm<PointsSystemFormData>({
    resolver: zodResolver(pointsSystemSchema),
    defaultValues: {
      seasonId,
      name: "",
      description: "",
      participationPoints: "10",
      knockoutPoints: "5",
    },
  });

  const allocationForm = useForm<PointsAllocationFormData>({
    resolver: zodResolver(pointsAllocationSchema),
    defaultValues: {
      position: "",
      positionEnd: "",
      points: "",
      description: "",
    },
  });

  const createPointsSystemMutation = useMutation({
    mutationFn: async (data: PointsSystemFormData) => {
      const payload = {
        ...data,
        participationPoints: data.participationPoints ? parseInt(data.participationPoints) : 0,
        knockoutPoints: data.knockoutPoints ? parseInt(data.knockoutPoints) : 0,
      };

      const response = await apiRequest("POST", "/api/points-systems", payload);
      return response.json();
    },
    onSuccess: async (pointsSystem) => {
      // Create allocations for the new points system
      for (const allocation of allocations) {
        await apiRequest("POST", "/api/points-allocations", {
          pointsSystemId: pointsSystem.id,
          position: allocation.position,
          positionEnd: allocation.positionEnd || null,
          points: allocation.points,
          description: allocation.description || null,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/seasons", seasonId, "points-systems"] });
      toast({
        title: "Success",
        description: "Points system created successfully!",
      });
      onOpenChange(false);
      form.reset();
      setAllocations([
        { id: '1', position: 1, points: 100, description: 'Winner bonus points' },
        { id: '2', position: 2, points: 75, description: 'Runner-up points' },
        { id: '3', position: 3, points: 50, description: 'Third place points' },
        { id: '4', position: 4, positionEnd: 10, points: 25, description: 'Final table points' },
      ]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create points system",
        variant: "destructive",
      });
    },
  });

  const addAllocation = (data: PointsAllocationFormData) => {
    const newAllocation: PointsAllocation = {
      id: Date.now().toString(),
      position: parseInt(data.position),
      positionEnd: data.positionEnd ? parseInt(data.positionEnd) : undefined,
      points: parseInt(data.points),
      description: data.description || undefined,
    };

    setAllocations(prev => [...prev, newAllocation].sort((a, b) => a.position - b.position));
    allocationForm.reset();
  };

  const removeAllocation = (id: string) => {
    setAllocations(prev => prev.filter(a => a.id !== id));
  };

  const onSubmit = (data: PointsSystemFormData) => {
    createPointsSystemMutation.mutate(data);
  };

  const getPositionDisplay = (allocation: PointsAllocation) => {
    if (allocation.positionEnd) {
      return `${allocation.position}-${allocation.positionEnd}`;
    }
    return allocation.position.toString();
  };

  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Points System Configuration"
      description="Customize point allocation for tournament placements"
      className="sm:max-w-[640px] md:max-w-[740px] lg:max-w-[840px]"
      footer={
        <>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            data-testid="cancel-points-system"
          >
            Cancel
          </Button>
          <Button 
            type="button"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createPointsSystemMutation.isPending}
            data-testid="save-points-system"
          >
            <Save className="w-4 h-4 mr-2" />
            {createPointsSystemMutation.isPending ? "Saving..." : "Save Points System"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
          {/* Season Info */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Season: {seasonName || seasonId}</h4>
              <p className="text-xs text-muted-foreground mt-1">Points settings for this season</p>
            </div>
            <Button variant="ghost" size="sm">
              <Copy className="w-4 h-4 mr-1" />
              Copy from Previous
            </Button>
          </div>

          <Form {...form}>
            <form className="space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  System Configuration
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>System Name*</FormLabel>
                        <FormControl>
                          <Input placeholder="Default Points System" {...field} data-testid="points-system-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="Standard tournament scoring" {...field} data-testid="points-system-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Point Allocations */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                    Point Allocation by Placement
                  </h4>
                </div>

                {allocations.map((allocation) => (
                  <Card key={allocation.id} className="border-border">
                    <CardContent className="p-4">
                      <div className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-3">
                          <div className="flex items-center gap-2">
                            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-sm font-bold">
                              {getPositionDisplay(allocation)}
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              {allocation.positionEnd ? 
                                `${allocation.position}${allocation.position === 1 ? 'st' : allocation.position === 2 ? 'nd' : allocation.position === 3 ? 'rd' : 'th'}-${allocation.positionEnd}${allocation.positionEnd === 1 ? 'st' : allocation.positionEnd === 2 ? 'nd' : allocation.positionEnd === 3 ? 'rd' : 'th'}` :
                                `${allocation.position}${allocation.position === 1 ? 'st' : allocation.position === 2 ? 'nd' : allocation.position === 3 ? 'rd' : 'th'} Place`
                              }
                            </span>
                          </div>
                        </div>
                        <div className="col-span-2">
                          <Badge variant="secondary" className="font-mono">
                            {allocation.points} pts
                          </Badge>
                        </div>
                        <div className="col-span-6">
                          <span className="text-sm text-muted-foreground">
                            {allocation.description || 'No description'}
                          </span>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button 
                            type="button"
                            variant="ghost" 
                            size="sm"
                            onClick={() => removeAllocation(allocation.id)}
                            data-testid={`remove-allocation-${allocation.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {/* Add new allocation form */}
                <Card className="border-dashed border-2 border-muted-foreground/25">
                  <CardContent className="p-4">
                    <Form {...allocationForm}>
                      <form onSubmit={allocationForm.handleSubmit(addAllocation)} className="space-y-4">
                        <div className="grid grid-cols-12 gap-4 items-end">
                          <div className="col-span-2">
                            <FormField
                              control={allocationForm.control}
                              name="position"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Start Position</FormLabel>
                                  <FormControl>
                                    <Input placeholder="1" {...field} data-testid="allocation-position" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormField
                              control={allocationForm.control}
                              name="positionEnd"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">End Position</FormLabel>
                                  <FormControl>
                                    <Input placeholder="Optional" {...field} data-testid="allocation-position-end" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormField
                              control={allocationForm.control}
                              name="points"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Points</FormLabel>
                                  <FormControl>
                                    <Input placeholder="100" {...field} data-testid="allocation-points" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-4">
                            <FormField
                              control={allocationForm.control}
                              name="description"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Description</FormLabel>
                                  <FormControl>
                                    <Input placeholder="Winner bonus" {...field} data-testid="allocation-description" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-2">
                            <Button type="submit" size="sm" data-testid="add-allocation">
                              <Plus className="w-4 h-4 mr-1" />
                              Add
                            </Button>
                          </div>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </div>

              {/* Additional Modifiers */}
              <div className="space-y-4 pt-6 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  Additional Point Modifiers
                </h4>
                
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <Checkbox id="participation" defaultChecked />
                    <div className="space-y-1 leading-none">
                      <label htmlFor="participation" className="text-sm font-medium text-foreground cursor-pointer">
                        Participation Points
                      </label>
                      <p className="text-xs text-muted-foreground">Award points just for playing</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pl-6">
                    <FormField
                      control={form.control}
                      name="participationPoints"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Base Points</FormLabel>
                          <FormControl>
                            <Input placeholder="10" {...field} data-testid="participation-points" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="flex items-start space-x-3">
                    <Checkbox id="knockout" />
                    <div className="space-y-1 leading-none">
                      <label htmlFor="knockout" className="text-sm font-medium text-foreground cursor-pointer">
                        Knockout Bonus
                      </label>
                      <p className="text-xs text-muted-foreground">Award points for eliminating players</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pl-6">
                    <FormField
                      control={form.control}
                      name="knockoutPoints"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Points per Knockout</FormLabel>
                          <FormControl>
                            <Input placeholder="5" {...field} data-testid="knockout-points" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Points will be automatically awarded to players based on their final tournament placement and any additional modifiers configured above.
                  </AlertDescription>
                </Alert>
              </div>
            </form>
          </Form>
      </div>
    </FormSlideout>
  );
}

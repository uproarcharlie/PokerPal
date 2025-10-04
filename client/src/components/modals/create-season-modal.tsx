import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FormSlideout } from "@/components/ui/form-slideout";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

const seasonSchema = z.object({
  name: z.string().min(1, "Season name is required"),
  clubId: z.string().min(1, "Club selection is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  isActive: z.boolean().default(true),
});

type SeasonFormData = z.infer<typeof seasonSchema>;

interface Club {
  id: string;
  name: string;
}

interface CreateSeasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSeasonModal({ open, onOpenChange }: CreateSeasonModalProps) {
  const { toast } = useToast();

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  const form = useForm<SeasonFormData>({
    resolver: zodResolver(seasonSchema),
    defaultValues: {
      name: "",
      clubId: "",
      startDate: "",
      endDate: "",
      isActive: true,
    },
  });

  const createSeasonMutation = useMutation({
    mutationFn: async (data: SeasonFormData) => {
      const payload = {
        ...data,
        startDate: new Date(data.startDate).toISOString(),
        endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
      };

      const response = await apiRequest("POST", "/api/seasons", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/seasons"] });
      toast({
        title: "Success",
        description: "Season created successfully!",
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create season",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SeasonFormData) => {
    createSeasonMutation.mutate(data);
  };

  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Season"
      description="Set up a new tournament season to organize events and track player progress over time."
      footer={
        <>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            data-testid="cancel-season"
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createSeasonMutation.isPending}
            data-testid="create-season-final"
          >
            <Check className="w-4 h-4 mr-2" />
            {createSeasonMutation.isPending ? "Creating..." : "Create Season"}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Season Name*</FormLabel>
                <FormControl>
                  <Input placeholder="Spring 2024" {...field} data-testid="season-name" />
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

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date*</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} data-testid="start-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>End Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} data-testid="end-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="is-active"
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
        </form>
      </Form>
    </FormSlideout>
  );
}

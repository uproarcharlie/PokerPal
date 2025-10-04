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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  description: z.string().optional(),
});

type ClubFormData = z.infer<typeof clubSchema>;

interface CreateClubModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateClubModal({ open, onOpenChange }: CreateClubModalProps) {
  const { toast } = useToast();

  const form = useForm<ClubFormData>({
    resolver: zodResolver(clubSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const createClubMutation = useMutation({
    mutationFn: async (data: ClubFormData) => {
      const response = await apiRequest("POST", "/api/clubs", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clubs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Club created successfully!",
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create club",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ClubFormData) => {
    createClubMutation.mutate(data);
  };

  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Club"
      description="Set up a new poker club to organize tournaments and manage your poker community."
      footer={
        <>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            data-testid="cancel-club"
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createClubMutation.isPending}
            data-testid="create-club-final"
          >
            <Check className="w-4 h-4 mr-2" />
            {createClubMutation.isPending ? "Creating..." : "Create Club"}
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
                  <FormLabel>Club Name*</FormLabel>
                  <FormControl>
                    <Input placeholder="Elite Poker Club" {...field} data-testid="club-name" />
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
                    <Textarea
                      rows={3}
                      placeholder="Describe your club, its mission, or special features..."
                      className="resize-none"
                      {...field}
                      data-testid="club-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
        </form>
      </Form>
    </FormSlideout>
  );
}

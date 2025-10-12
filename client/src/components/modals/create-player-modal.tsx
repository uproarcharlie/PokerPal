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
import { ImageUpload } from "@/components/ui/image-upload";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

const playerSchema = z.object({
  name: z.string().min(1, "Player name is required"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  phone: z.string().optional(),
  imageUrl: z.string().optional(),
});

type PlayerFormData = z.infer<typeof playerSchema>;

interface CreatePlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreatePlayerModal({ open, onOpenChange }: CreatePlayerModalProps) {
  const { toast } = useToast();

  const form = useForm<PlayerFormData>({
    resolver: zodResolver(playerSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      imageUrl: "",
    },
  });

  const createPlayerMutation = useMutation({
    mutationFn: async (data: PlayerFormData) => {
      const payload = {
        ...data,
        email: data.email || undefined,
        phone: data.phone || undefined,
      };

      const response = await apiRequest("POST", "/api/players", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Player created successfully!",
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create player",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: PlayerFormData) => {
    createPlayerMutation.mutate(data);
  };

  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Player"
      description="Add a new player to your poker database. Players can be registered for tournaments and tracked across seasons."
      footer={
        <>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            data-testid="cancel-player"
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createPlayerMutation.isPending}
            data-testid="create-player-final"
          >
            <Check className="w-4 h-4 mr-2" />
            {createPlayerMutation.isPending ? "Creating..." : "Create Player"}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="imageUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Player Photo</FormLabel>
                <FormControl>
                  <ImageUpload
                    onImageUpload={field.onChange}
                    currentImage={field.value}
                    entityType="players"
                    placeholder="Upload player photo or avatar"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Player Name*</FormLabel>
                <FormControl>
                  <Input placeholder="John Doe" {...field} data-testid="player-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="john@example.com"
                    {...field}
                    data-testid="player-email"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone Number</FormLabel>
                <FormControl>
                  <Input
                    placeholder="+1 (555) 123-4567"
                    {...field}
                    data-testid="player-phone"
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

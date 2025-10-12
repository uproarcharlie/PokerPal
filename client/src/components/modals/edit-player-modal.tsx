import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
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

interface Player {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  imageUrl?: string;
}

interface EditPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: Player | null;
}

export function EditPlayerModal({ open, onOpenChange, player }: EditPlayerModalProps) {
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

  // Update form values when player changes
  useEffect(() => {
    if (player) {
      form.reset({
        name: player.name || "",
        email: player.email || "",
        phone: player.phone || "",
        imageUrl: player.imageUrl || "",
      });
    }
  }, [player, form]);

  const updatePlayerMutation = useMutation({
    mutationFn: async (data: PlayerFormData) => {
      const payload = {
        ...data,
        email: data.email || undefined,
        phone: data.phone || undefined,
      };

      const response = await apiRequest("PUT", `/api/players/${player?.id}`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
      toast({
        title: "Success",
        description: "Player updated successfully!",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update player",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: PlayerFormData) => {
    updatePlayerMutation.mutate(data);
  };

  if (!player) return null;

  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Player"
      description="Update player information and profile."
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={form.handleSubmit(onSubmit)}
            disabled={updatePlayerMutation.isPending}
          >
            <Check className="w-4 h-4 mr-2" />
            {updatePlayerMutation.isPending ? "Saving..." : "Save Changes"}
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
                  <Input placeholder="John Doe" {...field} />
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

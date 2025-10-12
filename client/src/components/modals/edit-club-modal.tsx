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
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  address: z.string().optional(),
  timezone: z.string().optional(),
});

type ClubFormData = z.infer<typeof clubSchema>;

interface Club {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  address?: string;
  timezone?: string;
}

interface EditClubModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  club: Club | null;
}

export function EditClubModal({ open, onOpenChange, club }: EditClubModalProps) {
  const { toast } = useToast();

  const form = useForm<ClubFormData>({
    resolver: zodResolver(clubSchema),
    defaultValues: {
      name: "",
      description: "",
      imageUrl: "",
      address: "",
      timezone: "",
    },
  });

  // Update form values when club changes
  useEffect(() => {
    if (club) {
      form.reset({
        name: club.name || "",
        description: club.description || "",
        imageUrl: club.imageUrl || "",
        address: club.address || "",
        timezone: club.timezone || "",
      });
    }
  }, [club, form]);

  const updateClubMutation = useMutation({
    mutationFn: async (data: ClubFormData) => {
      const response = await apiRequest("PUT", `/api/clubs/${club?.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clubs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Club updated successfully!",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update club",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ClubFormData) => {
    updateClubMutation.mutate(data);
  };

  if (!club) return null;

  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Club"
      description="Update club information and profile."
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
            disabled={updateClubMutation.isPending}
          >
            <Check className="w-4 h-4 mr-2" />
            {updateClubMutation.isPending ? "Saving..." : "Save Changes"}
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
                <FormLabel>Club Image</FormLabel>
                <FormControl>
                  <ImageUpload
                    onImageUpload={field.onChange}
                    currentImage={field.value}
                    entityType="clubs"
                    placeholder="Upload club logo or image"
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
                <FormLabel>Club Name*</FormLabel>
                <FormControl>
                  <Input placeholder="Elite Poker Club" {...field} />
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
                  <RichTextEditor
                    content={field.value || ''}
                    onChange={field.onChange}
                    placeholder="Describe your club, its mission, or special features..."
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <AddressAutocomplete
                    value={field.value}
                    onChange={(address, timezone) => {
                      field.onChange(address);
                      if (timezone) {
                        form.setValue("timezone", timezone);
                      }
                    }}
                    placeholder="Start typing an address..."
                  />
                </FormControl>
                <FormMessage />
                {form.watch("timezone") && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Timezone: {form.watch("timezone")}
                  </p>
                )}
              </FormItem>
            )}
          />
        </form>
      </Form>
    </FormSlideout>
  );
}

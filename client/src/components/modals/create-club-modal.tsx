import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  slug: z.string()
    .min(1, "URL slug is required")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  timezone: z.string().optional(),
  address: z.string().optional(),
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
      slug: "",
      description: "",
      imageUrl: "",
      timezone: "",
      address: "",
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
                    <Input
                      placeholder="Elite Poker Club"
                      {...field}
                      data-testid="club-name"
                      onChange={(e) => {
                        field.onChange(e);
                        // Auto-generate slug from name
                        const slug = e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-+|-+$/g, '');
                        form.setValue('slug', slug);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL Slug*</FormLabel>
                  <FormControl>
                    <Input placeholder="elite-poker-club" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your club will be accessible at: club/{field.value || 'your-slug'}
                  </p>
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

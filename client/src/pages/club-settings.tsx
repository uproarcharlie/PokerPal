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
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, Trash2 } from "lucide-react";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  address: z.string().optional(),
  timezone: z.string().optional(),
  discordUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  twitterUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  facebookUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  instagramUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  websiteUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

type ClubFormData = z.infer<typeof clubSchema>;

interface Club {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  address?: string;
  timezone?: string;
  discordUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  websiteUrl?: string;
}

export default function ClubSettings() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: club, isLoading } = useQuery<Club>({
    queryKey: [`/api/clubs/${id}`],
  });

  const form = useForm<ClubFormData>({
    resolver: zodResolver(clubSchema),
    defaultValues: {
      name: "",
      description: "",
      imageUrl: "",
      address: "",
      timezone: "",
      discordUrl: "",
      twitterUrl: "",
      facebookUrl: "",
      instagramUrl: "",
      websiteUrl: "",
    },
  });

  // Update form values when club data loads
  useEffect(() => {
    if (club) {
      form.reset({
        name: club.name || "",
        description: club.description || "",
        imageUrl: club.imageUrl || "",
        address: club.address || "",
        timezone: club.timezone || "",
        discordUrl: club.discordUrl || "",
        twitterUrl: club.twitterUrl || "",
        facebookUrl: club.facebookUrl || "",
        instagramUrl: club.instagramUrl || "",
        websiteUrl: club.websiteUrl || "",
      });
    }
  }, [club, form]);

  const updateClubMutation = useMutation({
    mutationFn: async (data: ClubFormData) => {
      const response = await apiRequest("PUT", `/api/clubs/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clubs"] });
      queryClient.invalidateQueries({ queryKey: [`/api/clubs/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Club updated successfully!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update club",
        variant: "destructive",
      });
    },
  });

  const deleteClubMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/clubs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clubs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Club deleted successfully!",
      });
      setLocation("/clubs");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete club",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ClubFormData) => {
    updateClubMutation.mutate(data);
  };

  if (isLoading) {
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

  if (!club) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Club Not Found</h2>
          <p className="text-muted-foreground mb-6">The club you're looking for doesn't exist.</p>
          <Link href="/clubs">
            <Button>Back to Clubs</Button>
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
              <Link href="/clubs">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <h2 className="text-2xl font-bold text-foreground">{club.name} Settings</h2>
                <p className="text-sm text-muted-foreground mt-1">Manage club settings and preferences</p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Club
            </Button>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-4xl mx-auto">
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-1 mb-6">
            <TabsTrigger value="profile">Edit Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card>
              <CardContent className="pt-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">Social Links</h3>
                      <p className="text-sm text-muted-foreground">Add your club's social media and website links. Only filled links will be displayed.</p>

                      <FormField
                        control={form.control}
                        name="discordUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Discord</FormLabel>
                            <FormControl>
                              <Input placeholder="https://discord.gg/yourserver" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="twitterUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Twitter/X</FormLabel>
                            <FormControl>
                              <Input placeholder="https://twitter.com/yourclub" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="facebookUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Facebook</FormLabel>
                            <FormControl>
                              <Input placeholder="https://facebook.com/yourclub" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="instagramUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Instagram</FormLabel>
                            <FormControl>
                              <Input placeholder="https://instagram.com/yourclub" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="websiteUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Website</FormLabel>
                            <FormControl>
                              <Input placeholder="https://yourclub.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setLocation('/clubs')}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={updateClubMutation.isPending}
                      >
                        <Check className="w-4 h-4 mr-2" />
                        {updateClubMutation.isPending ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={() => deleteClubMutation.mutate()}
        title="Delete Club"
        description="Are you sure you want to delete this club? This action cannot be undone and will remove all associated seasons, tournaments, and data."
        itemName={club?.name}
        isDeleting={deleteClubMutation.isPending}
      />
    </div>
  );
}

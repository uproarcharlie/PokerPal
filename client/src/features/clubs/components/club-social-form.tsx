import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Check } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { clubSocialFormSchema, socialValues, type ClubSocialField, type ClubSocialValues } from "../club-form";
import { useUpdateClub } from "../staff-hooks";
import { formResolver, showServerFieldErrors } from "@/lib/forms";

const LINKS: ReadonlyArray<{ name: ClubSocialField; label: string; placeholder: string }> = [
  { name: "discordUrl", label: "Discord", placeholder: "https://discord.gg/yourserver" },
  { name: "twitterUrl", label: "Twitter/X", placeholder: "https://x.com/yourclub" },
  { name: "facebookUrl", label: "Facebook", placeholder: "https://facebook.com/yourclub" },
  { name: "instagramUrl", label: "Instagram", placeholder: "https://instagram.com/yourclub" },
  { name: "websiteUrl", label: "Website", placeholder: "https://yourclub.co.nz" },
];

const FIELDS = LINKS.map((link) => link.name);

/** The settings' Social links tab: the links the club's public page shows (only the filled ones). */
export function ClubSocialForm({ club }: { club: ClubDto }) {
  const { toast } = useToast();
  const update = useUpdateClub(club.id);
  const form = useForm<ClubSocialValues>({ resolver: formResolver(clubSocialFormSchema), defaultValues: socialValues(club) });

  const onSubmit = form.handleSubmit(async (values) => {
    let saved: ClubDto;
    try {
      saved = await update.mutateAsync(clubSocialFormSchema.parse(values));
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: FIELDS })) {
        toast({ title: "Could not save the links", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    form.reset(socialValues(saved));
    toast({ title: "Club updated successfully!" });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Social Links</CardTitle>
        <CardDescription>Add your club's social media and website links. Only filled links will be displayed.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {LINKS.map((link) => (
              <FormField
                key={link.name}
                control={form.control}
                name={link.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{link.label}</FormLabel>
                    <FormControl>
                      <Input type="url" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder={link.placeholder} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <div className="flex flex-wrap justify-end gap-3 pt-4">
              <Button asChild variant="outline">
                <Link href={routes.clubs()}>Cancel</Link>
              </Button>
              <Button type="submit" busy={update.isPending}>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                {update.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

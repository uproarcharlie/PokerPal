import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Check } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { clubProfileFormSchema, profileValues, type ClubProfileValues } from "../club-form";
import { useUpdateClub } from "../staff-hooks";
import { ClubProfileFields } from "./club-profile-fields";
import { formResolver, showServerFieldErrors } from "@/lib/forms";

const FIELDS = ["name", "slug", "description", "imageUrl", "address", "timezone"] as const;

/**
 * The settings' Profile tab. It starts from the club as loaded and is mounted once per club (the page
 * keys it by id), so a refresh of the club never wipes a half-typed edit; after a save it shows what the
 * server stored (a description comes back cleaned).
 */
export function ClubProfileForm({ club }: { club: ClubDto }) {
  const { toast } = useToast();
  const update = useUpdateClub(club.id);
  const [uploading, setUploading] = useState(false);
  const schema = useMemo(() => clubProfileFormSchema(club.slug), [club.slug]);
  const form = useForm<ClubProfileValues>({ resolver: formResolver(schema), defaultValues: profileValues(club) });

  const onSubmit = form.handleSubmit(async (values) => {
    if (uploading) return;
    let saved: ClubDto;
    try {
      saved = await update.mutateAsync(schema.parse(values));
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { SLUG_TAKEN: "slug" } })) {
        toast({ title: "Could not save the club", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    form.reset(profileValues(saved));
    toast({ title: "Club updated successfully!" });
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <ClubProfileFields form={form} onUploadingChange={setUploading} />
            <div className="flex flex-wrap justify-end gap-3 pt-4">
              <Button asChild variant="outline">
                <Link href={routes.clubs()}>Cancel</Link>
              </Button>
              <Button type="submit" disabled={uploading} busy={update.isPending}>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                {uploading ? "Uploading image…" : update.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

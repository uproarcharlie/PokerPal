import { useForm } from "react-hook-form";
import type { z } from "zod";
import { updateProfileSchema, type SessionUser } from "@shared/api/auth";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { showServerFieldErrors, formResolver } from "@/lib/forms";
import { useUpdateProfile } from "../hooks";

type ProfileFormValues = Omit<z.input<typeof updateProfileSchema>, "phone"> & { phone: string };

const FIELDS = ["name", "email", "phone"] as const;

const valuesOf = (user: SessionUser): ProfileFormValues => ({ name: user.name, email: user.email, phone: user.phone ?? "" });

/** The signed-in user's name, email and phone. Render it with `key={user.id}`: it starts from the user it is given. */
export function ProfileForm({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const save = useUpdateProfile();
  const form = useForm<ProfileFormValues>({
    resolver: formResolver(updateProfileSchema),
    defaultValues: valuesOf(user),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { user: saved } = await save.mutateAsync(updateProfileSchema.parse(values));
      form.reset(valuesOf(saved));
      toast({ title: "Profile updated", description: "Your profile has been updated successfully." });
    } catch (error) {
      if (showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { EMAIL_TAKEN: "email" } })) return;
      toast({ title: "Update failed", description: errorMessage(error), variant: "destructive" });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="name" />
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
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} type="email" autoComplete="email" />
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
              <FormLabel>Phone (Optional)</FormLabel>
              <FormControl>
                <Input {...field} type="tel" placeholder="e.g. 021 123 4567" autoComplete="tel" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" busy={save.isPending}>
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

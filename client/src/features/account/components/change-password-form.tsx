import { useForm } from "react-hook-form";
import { z } from "zod";
import { changePasswordSchema } from "@shared/api/auth";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { showServerFieldErrors, formResolver } from "@/lib/forms";
import { useChangePassword } from "../hooks";
import { newPasswordSchema, PASSWORD_RULES } from "../password-rules";
import { PasswordInput } from "./password-input";

const changePasswordFormSchema = changePasswordSchema
  .extend({ newPassword: newPasswordSchema, confirmPassword: z.string().min(1, "Required") })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "New password and confirmation must match.",
    path: ["confirmPassword"],
  });

type ChangePasswordFormValues = z.input<typeof changePasswordFormSchema>;

const EMPTY: ChangePasswordFormValues = { currentPassword: "", newPassword: "", confirmPassword: "" };
const FIELDS = ["currentPassword", "newPassword"] as const;

/** The current password, then the new one twice. Every other device is signed out once it changes. */
export function ChangePasswordForm() {
  const { toast } = useToast();
  const change = useChangePassword();
  const form = useForm<ChangePasswordFormValues>({ resolver: formResolver(changePasswordFormSchema), defaultValues: EMPTY });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await change.mutateAsync(changePasswordSchema.parse(values));
      form.reset(EMPTY);
      toast({ title: "Password changed", description: "Your password has been changed successfully." });
    } catch (error) {
      if (showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { WRONG_PASSWORD: "currentPassword", WEAK_PASSWORD: "newPassword" } })) return;
      toast({ title: "Password change failed", description: errorMessage(error), variant: "destructive" });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current Password</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="current-password" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New Password</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" />
              </FormControl>
              <FormDescription>{PASSWORD_RULES}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm New Password</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" busy={change.isPending}>
            {change.isPending ? "Changing..." : "Change Password"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

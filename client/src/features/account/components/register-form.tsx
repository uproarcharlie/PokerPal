import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { registerSchema } from "@shared/api/auth";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { authProblem, type FormProblem } from "../auth-errors";
import { showServerFieldErrors, formResolver } from "@/lib/forms";
import { newPasswordSchema, PASSWORD_RULES } from "../password-rules";
import { FormAlert } from "./auth-card";
import { PasswordInput } from "./password-input";

const registerFormSchema = registerSchema
  .extend({ password: newPasswordSchema, confirmPassword: z.string().min(1, "Required") })
  .refine((values) => values.password === values.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

type RegisterFormValues = Omit<z.input<typeof registerFormSchema>, "phone"> & { phone: string };

const FIELDS = ["name", "email", "phone", "password"] as const;

/** A new full member's name, email, optional phone and password (twice). Signed up, the page moves on by itself. */
export function RegisterForm({ footer }: { footer: ReactNode }) {
  const { register } = useAuth();
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const form = useForm<RegisterFormValues>({
    resolver: formResolver(registerFormSchema),
    defaultValues: { name: "", email: "", phone: "", password: "", confirmPassword: "" },
  });
  const submitting = form.formState.isSubmitting;

  const onSubmit = form.handleSubmit(async (values) => {
    setProblem(null);
    const { email, password, name, phone } = registerSchema.parse(values);
    try {
      await register(email, password, name, phone ?? undefined);
    } catch (error) {
      if (showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { EMAIL_TAKEN: "email", WEAK_PASSWORD: "password" } })) return;
      setProblem(authProblem(error, "Account not created"));
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          {problem ? <FormAlert title={problem.title} message={problem.message} /> : null}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Full Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g. Jane Smith" autoComplete="name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input {...field} type="email" placeholder="e.g. you@example.com" autoComplete="email" />
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Password</FormLabel>
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
              <FormItem required>
                <FormLabel>Confirm Password</FormLabel>
                <FormControl>
                  <PasswordInput {...field} autoComplete="new-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" busy={submitting}>
            {submitting ? "Creating Account..." : "Create Account"}
          </Button>
          {footer}
        </CardFooter>
      </form>
    </Form>
  );
}

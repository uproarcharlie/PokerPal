import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { loginSchema } from "@shared/api/auth";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { hasErrorCode } from "@/lib/api/http";
import { authProblem, type FormProblem } from "../auth-errors";
import { showServerFieldErrors, formResolver } from "@/lib/forms";
import { FormAlert } from "./auth-card";
import { PasswordInput } from "./password-input";

type LoginFormValues = z.input<typeof loginSchema>;

const FIELDS = ["email", "password"] as const;

/**
 * Email and password. A refusal shows above the form in words that say what to do (a wrong password,
 * too many attempts: wait, no connection); signed in, the page moves on by itself.
 */
export function LoginForm({ footer }: { footer: ReactNode }) {
  const { login } = useAuth();
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const form = useForm<LoginFormValues>({
    resolver: formResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const submitting = form.formState.isSubmitting;

  const onSubmit = form.handleSubmit(async (values) => {
    setProblem(null);
    const { email, password } = loginSchema.parse(values);
    try {
      await login(email, password);
    } catch (error) {
      if (showServerFieldErrors(form.setError, error, { fields: FIELDS })) return;
      setProblem(authProblem(error, "Sign-in failed"));
      if (hasErrorCode(error, "INVALID_CREDENTIALS")) {
        form.resetField("password");
        form.setFocus("password");
      }
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          {problem ? <FormAlert title={problem.title} message={problem.message} /> : null}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
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
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput {...field} autoComplete="current-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" busy={submitting}>
            {submitting ? "Signing In..." : "Sign In"}
          </Button>
          {footer}
        </CardFooter>
      </form>
    </Form>
  );
}

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { BrandMark } from "@/features/landing/components/brand-mark";

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** The sign-in and sign-up screens' frame: the platform's mark and a centred card on a dark backdrop. */
export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-foreground via-foreground/90 to-foreground px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="mb-2 flex justify-center">
            <BrandMark size="xl" nameClassName="text-2xl" />
          </div>
          <h1 className="text-center text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          <CardDescription className="text-center">{description}</CardDescription>
        </CardHeader>
        {children}
      </Card>
    </div>
  );
}

interface FormAlertProps {
  title: string;
  message: string;
}

/** A refusal that belongs to no single field (wrong password, too many attempts, no connection), above the form. */
export function FormAlert({ title, message }: FormAlertProps) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">{title}</p>
        <p>{message}</p>
      </div>
    </div>
  );
}

import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AccessDeniedProps {
  message: string;
  backHref: string;
  backLabel: string;
}

/** A staff page for a club the signed-in user does not run (the API would answer 403). */
export function AccessDenied({ message, backHref, backLabel }: AccessDeniedProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
        <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-destructive" aria-hidden="true" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">Access Denied</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Button asChild>
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

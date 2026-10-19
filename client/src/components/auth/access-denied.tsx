import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface AccessDeniedProps {
  message: string;
  backHref: string;
  backLabel: string;
}

/** A staff page for a club the signed-in user does not run (the API would answer 403). */
export function AccessDenied({ message, backHref, backLabel }: AccessDeniedProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md">
        <CardContent className="pt-6">
          <div className="text-center">
            <ShieldAlert className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-6">{message}</p>
            <Link href={backHref}>
              <Button>{backLabel}</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Link, Redirect, useSearch } from "wouter";
import { usePageMeta } from "@/app/page-meta";
import { routes } from "@/app/routes";
import { PageSpinner } from "@/components/shared/page-spinner";
import { useAuth } from "@/contexts/auth-context";
import { nextPath, withNext } from "@/lib/next-path";
import { AuthCard } from "../components/auth-card";
import { RegisterForm } from "../components/register-form";

export default function RegisterPage() {
  usePageMeta({ title: "Create account" });
  const search = useSearch();
  const { loading, isAuthenticated } = useAuth();

  if (loading) return <PageSpinner label="Checking your sign-in" className="min-h-dvh" />;
  // Back to where sign-up was asked for (an invitation link), else the clubs list.
  if (isAuthenticated) return <Redirect to={nextPath(search, routes.staffHome())} replace />;

  return (
    <AuthCard title="Create Account" description="Register as a full member to access all features">
      <RegisterForm
        footer={
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href={withNext(routes.login(), search)} className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        }
      />
    </AuthCard>
  );
}

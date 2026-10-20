import { Link, Redirect, useSearch } from "wouter";
import { usePageMeta } from "@/app/page-meta";
import { routes } from "@/app/routes";
import { PageSpinner } from "@/components/shared/page-spinner";
import { useAuth } from "@/contexts/auth-context";
import { nextPath, withNext } from "@/lib/next-path";
import { AuthCard } from "../components/auth-card";
import { LoginForm } from "../components/login-form";

export default function LoginPage() {
  usePageMeta({ title: "Sign in" });
  const search = useSearch();
  const { loading, isAuthenticated } = useAuth();

  // Not the form while it is still unknown whether someone is signed in: it would flash, then vanish.
  if (loading) return <PageSpinner label="Checking your sign-in" className="min-h-dvh" />;
  // Back to where sign-in was asked for (an invitation link), else the clubs list.
  if (isAuthenticated) return <Redirect to={nextPath(search, routes.staffHome())} replace />;

  return (
    <AuthCard title="Welcome Back" description="Sign in to your account to continue">
      <LoginForm
        footer={
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href={withNext(routes.register(), search)} className="font-medium text-primary hover:underline">
              Register
            </Link>
          </p>
        }
      />
    </AuthCard>
  );
}

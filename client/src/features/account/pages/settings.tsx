import type { ReactNode } from "react";
import { Lock, Shield, User, type LucideIcon } from "lucide-react";
import { usePageMeta } from "@/app/page-meta";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { roleLabel } from "@/features/users/roles";
import { ChangePasswordForm } from "../components/change-password-form";
import { ProfileForm } from "../components/profile-form";

function SettingsSection({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <CardTitle id={id} className="text-xl">
              {title}
            </CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

export default function SettingsPage() {
  usePageMeta({ title: "Settings" });
  // The staff layout only shows this page to someone signed in.
  const { user } = useAuth();
  if (!user) return null;

  return (
    <>
      <PageHeader title="Settings" description="Manage your account settings and preferences" />
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <SettingsSection icon={Shield} title="Account Information" description="View your account details and role">
          <dl className="grid gap-4 md:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Account ID</dt>
              <dd className="mt-1 break-all rounded bg-muted px-3 py-2 font-mono text-sm text-foreground">{user.id}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Role</dt>
              <dd className="mt-1 px-3 py-2 text-sm font-medium text-foreground">{roleLabel(user.role)}</dd>
            </div>
          </dl>
        </SettingsSection>

        <SettingsSection icon={User} title="Profile Information" description="Update your personal information">
          <ProfileForm key={user.id} user={user} />
        </SettingsSection>

        <SettingsSection icon={Lock} title="Change Password" description="Update your password to keep your account secure">
          <ChangePasswordForm />
        </SettingsSection>
      </div>
    </>
  );
}

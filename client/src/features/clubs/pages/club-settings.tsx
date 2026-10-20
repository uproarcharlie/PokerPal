import { useParams } from "wouter";
import type { ClubDto } from "@shared/api/public";
import { usePageMeta } from "@/app/page-meta";
import { routes } from "@/app/routes";
import { AccessDenied } from "@/components/auth/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { PageSpinner } from "@/components/shared/page-spinner";
import { PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { TabHost, type HostedTab } from "@/components/shared/tab-host";
import { useAuth } from "@/contexts/auth-context";
import { clubTimeZone } from "@/lib/format";
import { ClubNotFound } from "../components/club-not-found";
import { ClubProfileForm } from "../components/club-profile-form";
import { ClubSocialForm } from "../components/club-social-form";
import { ClubStaffCard } from "../components/club-staff-card";
import { DeleteClubButton } from "../components/delete-club-button";
import { useClub } from "../hooks";
import { useClubStaff } from "../staff-hooks";

/** The owner, managers and invitations: read only by the owner and admins. */
function ManagersTab({ club, canInviteOwner }: { club: ClubDto; canInviteOwner: boolean }) {
  const staff = useClubStaff(club.id, true);
  return (
    <QueryState query={staff} errorTitle="The club's managers could not be loaded">
      {(data) => <ClubStaffCard clubId={club.id} staff={data} canInviteOwner={canInviteOwner} timeZone={clubTimeZone(club)} />}
    </QueryState>
  );
}

function ClubSettings({ club }: { club: ClubDto }) {
  const { isAdmin } = useAuth();
  // Each tab is one entry; a club's branding (Phase 5) is another.
  const tabs: HostedTab[] = [
    { value: "profile", label: "Profile", content: <ClubProfileForm club={club} />, keepMounted: true },
    { value: "social", label: "Social links", content: <ClubSocialForm club={club} />, keepMounted: true },
  ];
  // Managers and deletion are the owner's and admins' (the staff list answers 403 to managers).
  if (club.viewer.canOwn) tabs.push({ value: "managers", label: "Managers", content: <ManagersTab club={club} canInviteOwner={isAdmin} /> });

  return (
    <>
      <PageHeader
        title={`${club.name} Settings`}
        description="Manage club settings and preferences"
        back={{ href: routes.clubs(), label: "Clubs" }}
        actions={club.viewer.canOwn ? <DeleteClubButton club={club} /> : undefined}
      />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <TabHost tabs={tabs} />
      </div>
    </>
  );
}

/** A club's settings, for the people who run it: profile, social links and (owner, admins) its managers. */
export default function ClubSettingsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const club = useClub(id);
  usePageMeta({ title: club.data ? `${club.data.name} settings` : "Club settings" });

  return (
    <QueryState
      query={club}
      loading={<PageSpinner label="Loading the club" />}
      notFound={<ClubNotFound />}
      errorTitle="This club could not be loaded"
      stateClassName={PAGE_STATE_CLASS}
    >
      {(loaded) =>
        loaded.viewer.canManage ? (
          <ClubSettings key={loaded.id} club={loaded} />
        ) : (
          <AccessDenied
            message="You don't have permission to edit this club's settings. Only the club's owner, its managers and admins can."
            backHref={routes.clubs()}
            backLabel="Back to Clubs"
          />
        )
      }
    </QueryState>
  );
}

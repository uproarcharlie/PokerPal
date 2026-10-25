import { useId } from "react";
import type { ClubDto } from "@shared/api/public";
import { Switch } from "@/components/ui/switch";
import { useUpdateClub } from "@/features/clubs/staff-hooks";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";

/**
 * Club settings: "Require a photo to sign up" (clubs.require_signup_photo, round 5, item 7). On, a new
 * player signing up from the club's QR page must take a selfie, upload a photo or pick an avatar (the
 * server refuses them otherwise, PHOTO_REQUIRED); off (the default), the photo can be skipped. Saved as
 * soon as it is switched; the whole row is the switch's label, so it is a big target on a phone.
 */
export function SignupPhotoField({ club }: { club: ClubDto }) {
  const { toast } = useToast();
  const update = useUpdateClub(club.id);
  const switchId = useId();
  const titleId = useId();
  const descriptionId = useId();
  // What was asked for, while it saves; then what the club has.
  const required = update.isPending ? update.variables.requireSignupPhoto === true : club.requireSignupPhoto;

  const change = async (requireSignupPhoto: boolean) => {
    // A press while the last one saves is ignored, as every busy control does (MA-REV-02).
    if (update.isPending) return;
    try {
      await update.mutateAsync({ requireSignupPhoto });
      toast({
        title: requireSignupPhoto ? "Photo now required" : "Photo now optional",
        description: requireSignupPhoto
          ? "New players add a selfie, a photo or an avatar to sign up."
          : "New players can skip the photo when they sign up.",
      });
    } catch (error) {
      toast({ title: "Could not save the photo setting", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <label
      htmlFor={switchId}
      className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4"
      data-testid="signup-photo-field"
    >
      <span className="space-y-0.5">
        <span id={titleId} className="block text-base font-medium text-foreground">
          Require a photo to sign up
        </span>
        <span id={descriptionId} className="block text-sm text-muted-foreground">
          New players signing up from the QR code must take a selfie, upload a photo or pick an avatar. Returning players keep theirs.
        </span>
      </span>
      <Switch
        id={switchId}
        checked={required}
        onCheckedChange={(checked) => void change(checked)}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-disabled={update.isPending}
        disabled={!club.viewer.canManage}
      />
    </label>
  );
}

import { ImageField } from "@/components/image/image-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { RegistrationFlow } from "../use-registration-flow";
import { PrivacyNotice } from "./privacy-notice";

/** Step 2 for a first-timer: an optional photo (camera or upload), their name and phone number. */
export function NewPlayerStep({ flow }: { flow: RegistrationFlow }) {
  const { form, photoUploading, creatingPlayer } = flow;
  return (
    <Form {...form}>
      <form onSubmit={(event) => void flow.submitNewPlayer(event)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="imageUrl"
          render={({ field }) => (
            <FormItem>
              <ImageField
                kind="player_avatar"
                label="Your Photo (Optional)"
                description={
                  flow.photoLocked
                    ? "Saved with your sign-up. The TD can change your photo at the desk."
                    : "Shown next to your name on the standings. Take one now, or choose one from your phone."
                }
                disabled={flow.photoLocked}
                value={field.value}
                onChange={field.onChange}
                onUploadingChange={flow.setPhotoUploading}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Sam Taylor" autoComplete="name" className="h-11" {...field} data-testid="player-name" />
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
              <FormLabel>Phone Number</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="e.g. 021 123 4567"
                  autoComplete="tel"
                  className="h-11"
                  {...field}
                  data-testid="player-phone"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <PrivacyNotice />
        {flow.signUpError ? (
          <Alert variant="destructive" data-testid="sign-up-problem">
            <AlertDescription>{flow.signUpError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={flow.back} data-testid="step2-back">
            Back
          </Button>
          <Button type="submit" className="h-11 flex-1" disabled={photoUploading} busy={creatingPlayer} data-testid="step2-next">
            {photoUploading ? "Uploading photo..." : creatingPlayer ? "Creating..." : "Continue"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

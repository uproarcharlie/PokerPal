import { Suspense } from "react";
import type { UseFormReturn } from "react-hook-form";
import { SectionErrorBoundary } from "@/app/error-boundary";
import { lazyPage } from "@/app/lazy-page";
import { ImageField } from "@/components/image/image-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { slugFromName, type ClubProfileValues } from "../club-form";
import { AddressAutocomplete } from "./address-autocomplete";
import { TimeZoneSelect } from "./time-zone-select";

// The editor (tiptap and ProseMirror, about 400 kB) loads only when a club form is shown, not with the
// pages that merely offer one (the clubs list's Create Club). It loads as pages do (asked again once
// after a dropped request, onto a new version after a deploy, afresh after a failure), and a failure
// takes only the Description box down, never the form and what was typed (P3REV4-PERF-B).
const RichTextEditor = lazyPage(() => import("./rich-text-editor").then((module) => ({ default: module.RichTextEditor })));

function EditorUnavailable({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive">
      <span>The editor could not be loaded. Check your connection.</span>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

function EditorPlaceholder() {
  return (
    <div role="status" className="space-y-2 rounded-md border p-2">
      <span className="sr-only">Loading the editor</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[100px] w-full" />
    </div>
  );
}

interface ClubProfileFieldsProps {
  form: UseFormReturn<ClubProfileValues>;
  /** Fills the URL slug from the name as it is typed (a new club). */
  slugFromNameAsTyped?: boolean;
  /** True while the logo uploads: the form's Save waits for it. */
  onUploadingChange: (uploading: boolean) => void;
}

/** A club's profile: logo, name, public URL, description, address and time zone. */
export function ClubProfileFields({ form, slugFromNameAsTyped = false, onUploadingChange }: ClubProfileFieldsProps) {
  return (
    <>
      <FormField
        control={form.control}
        name="imageUrl"
        render={({ field }) => (
          <FormItem>
            <ImageField
              kind="club_logo"
              label="Club logo"
              value={field.value}
              onChange={field.onChange}
              onUploadingChange={onUploadingChange}
              description="Shown whole, never cropped: a square or wide logo both work. JPEG, PNG, WebP or GIF."
            />
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem required>
            <FormLabel>Club Name</FormLabel>
            <FormControl>
              <Input
                placeholder="e.g. Elite Poker Club"
                autoComplete="organization"
                data-testid="club-name"
                {...field}
                onChange={(event) => {
                  field.onChange(event);
                  if (slugFromNameAsTyped) form.setValue("slug", slugFromName(event.target.value), { shouldValidate: form.formState.isSubmitted });
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="slug"
        render={({ field }) => (
          <FormItem required>
            <FormLabel>URL Slug</FormLabel>
            <FormControl>
              <Input placeholder="e.g. elite-poker-club" autoCapitalize="none" spellCheck={false} {...field} />
            </FormControl>
            <FormDescription>Your club will be accessible at: club/{field.value || "your-slug"}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            {/* Not a <label>: the editor is not a form control; it is named by its own aria-label. */}
            <p className="text-sm font-medium leading-none">Description</p>
            <SectionErrorBoundary fallback={(retry) => <EditorUnavailable retry={retry} />}>
              <Suspense fallback={<EditorPlaceholder />}>
                <RichTextEditor
                  content={field.value}
                  onChange={field.onChange}
                  label="Description"
                  placeholder="Describe your club, its mission, or special features..."
                />
              </Suspense>
            </SectionErrorBoundary>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl>
              <AddressAutocomplete {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="timezone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Time zone</FormLabel>
            <FormControl>
              <TimeZoneSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} name={field.name} />
            </FormControl>
            <FormDescription>Dates and start times on your club's pages are shown in this time zone.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

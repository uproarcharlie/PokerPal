import { useForm } from "react-hook-form";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { useCreatePointsSystem } from "../staff-hooks";
import { EMPTY_POINTS_SYSTEM, isPointsSystemField, pointsSystemFormSchema, type PointsSystemFormValues } from "../points-system-values";
import { AllocationRows } from "./allocation-rows";

/** "Create New Points System": the system and its position points, saved together in one request. */
export function PointsSystemForm({ seasonId }: { seasonId: string }) {
  const { toast } = useToast();
  const create = useCreatePointsSystem(seasonId);
  const form = useForm<PointsSystemFormValues>({
    resolver: formResolver(pointsSystemFormSchema),
    defaultValues: EMPTY_POINTS_SYSTEM,
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(pointsSystemFormSchema.parse(values));
    } catch (error) {
      const rows = form.getValues("allocations").length;
      if (!showServerFieldErrors(form.setError, error, { fields: (name) => isPointsSystemField(name, rows) })) {
        toast({ title: "Could not create the points system", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: "Points system created successfully!" });
    form.reset(EMPTY_POINTS_SYSTEM);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>System Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Standard Points" autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Points awarded based on placement" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="participationPoints"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Participation Points</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" placeholder="0" {...field} />
                </FormControl>
                <FormDescription>Points for participating</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="knockoutPoints"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Knockout Points</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" placeholder="0" {...field} />
                </FormControl>
                <FormDescription>Points per knockout</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <AllocationRows control={form.control} />
        <div className="flex justify-end pt-4">
          <Button type="submit" busy={create.isPending}>
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {create.isPending ? "Creating..." : "Create Points System"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

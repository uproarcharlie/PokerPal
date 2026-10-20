import { useForm } from "react-hook-form";
import { adminUpdateUserSchema, type AdminUserRow, type UserRole } from "@shared/api/admin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showServerFieldErrors, formResolver } from "@/lib/forms";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { useUpdateUser } from "../hooks";
import { ROLE_CHOICES } from "../user-filter";

type AccountRow = Extract<AdminUserRow, { type: "user" }>;

interface UserFormValues {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
}

const FIELDS = ["name", "email", "phone", "role", "isActive"] as const;

interface EditUserDialogProps {
  /** The account being edited; null when closed. */
  user: AccountRow | null;
  /** The signed-in admin: their own role and status are not theirs to change (the server refuses). */
  currentUserId: string | undefined;
  onClose: () => void;
}

/** An admin's edit of an account: name, email, phone, and (for anyone but themselves) role and status. */
export function EditUserDialog({ user, currentUserId, onClose }: EditUserDialogProps) {
  return (
    <Dialog open={user !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Update user information and permissions</DialogDescription>
        </DialogHeader>
        {user ? <UserForm key={user.id} user={user} editingSelf={user.id === currentUserId} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function UserForm({ user, editingSelf, onDone }: { user: AccountRow; editingSelf: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const save = useUpdateUser();
  const form = useForm<UserFormValues>({
    defaultValues: {
      name: user.name,
      email: user.email,
      phone: user.phone ?? "",
      role: user.role,
      isActive: user.isActive === true,
    },
    resolver: formResolver(adminUpdateUserSchema),
  });

  const onSubmit = form.handleSubmit(async ({ name, email, phone, role, isActive }) => {
    // The server refuses an admin's change to their own role or status (CANNOT_MODIFY_SELF).
    const input = adminUpdateUserSchema.parse(editingSelf ? { name, email, phone } : { name, email, phone, role, isActive });
    try {
      await save.mutateAsync({ id: user.id, input });
      toast({ title: "User updated", description: "User has been updated successfully." });
      onDone();
    } catch (error) {
      if (showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { EMAIL_TAKEN: "email" } })) return;
      toast({ title: "Update failed", description: errorMessage(error), variant: "destructive" });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} type="email" />
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
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input {...field} type="tel" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {editingSelf ? (
          <p className="text-sm text-muted-foreground">You can&apos;t change your own role or status. Another admin can.</p>
        ) : (
          <>
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROLE_CHOICES.map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value ? "active" : "disabled"} onValueChange={(value) => field.onChange(value === "active")}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending}>
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

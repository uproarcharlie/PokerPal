import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { FormSlideout } from "@/components/ui/form-slideout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MIN_SEARCH_LENGTH, PlayerSearch, type PlayerSearchWording } from "@/components/player/player-search";
import { apiJson, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PublicPlayer, PublicRegistration } from "@shared/api/public";
import { Check } from "lucide-react";

const countsSchema = z.object({
  buyIns: z.string().regex(/^\d+$/, "Must be a positive number").min(1, "At least 1 buy-in required"),
  rebuys: z.string().regex(/^\d*$/, "Must be a number").optional(),
  addons: z.string().regex(/^\d*$/, "Must be a number").optional(),
});

type CountsFormData = z.infer<typeof countsSchema>;

const STAFF_WORDING: PlayerSearchWording = {
  placeholder: "Start typing the player's name",
  label: "Search for a player",
  tooShort: `Type at least ${MIN_SEARCH_LENGTH} letters of their name.`,
  noMatch: "Nobody who has played before has that name. A new player signs up on the registration page.",
};

interface RegisterPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
}

/**
 * The TD's desk: find a player who has played before (at this club or any other) by name and register
 * them with their opening entries. New players sign up on the registration page, where the TD can
 * also enter them without a phone number.
 */
export function RegisterPlayerModal({ open, onOpenChange, tournamentId }: RegisterPlayerModalProps) {
  const { toast } = useToast();
  const [player, setPlayer] = useState<PublicPlayer | null>(null);

  const form = useForm<CountsFormData>({
    resolver: zodResolver(countsSchema),
    defaultValues: { buyIns: "1", rebuys: "0", addons: "0" },
  });

  const close = () => {
    onOpenChange(false);
    setPlayer(null);
    form.reset();
  };

  const registerPlayerMutation = useMutation({
    mutationFn: (data: CountsFormData & { playerId: string }) =>
      apiJson<PublicRegistration>("POST", `/api/tournaments/${tournamentId}/registrations`, {
        playerId: data.playerId,
        buyIns: parseInt(data.buyIns),
        rebuys: parseInt(data.rebuys || "0"),
        addons: parseInt(data.addons || "0"),
      }),
    onSuccess: (registration) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Player registered", description: `${registration.player?.name ?? "The player"} is in.` });
      close();
    },
    onError: (error: Error) => {
      toast({ title: "Could not register the player", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: CountsFormData) => {
    if (player) registerPlayerMutation.mutate({ ...data, playerId: player.id });
  };

  return (
    <FormSlideout
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Register Player"
      description="Find a player who has played before and add them to this tournament."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} data-testid="cancel-registration">
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={form.handleSubmit(onSubmit)}
            disabled={registerPlayerMutation.isPending || !player}
            data-testid="register-player-final"
          >
            <Check className="w-4 h-4 mr-2" />
            {registerPlayerMutation.isPending ? "Registering..." : "Register Player"}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Player*</Label>
            <PlayerSearch tournamentId={tournamentId} selected={player} onSelect={setPlayer} wording={STAFF_WORDING} />
            <p className="text-xs text-muted-foreground">
              Someone new?{" "}
              <Link href={`/register/${tournamentId}`} className="underline">
                Sign them up on the registration page
              </Link>
              .
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="buyIns"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Buy-ins*</FormLabel>
                  <FormControl>
                    <Input placeholder="1" {...field} data-testid="buyins-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rebuys"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Re-buys</FormLabel>
                  <FormControl>
                    <Input placeholder="0" {...field} data-testid="rebuys-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="addons"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Add-ons</FormLabel>
                  <FormControl>
                    <Input placeholder="0" {...field} data-testid="addons-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </form>
      </Form>
    </FormSlideout>
  );
}

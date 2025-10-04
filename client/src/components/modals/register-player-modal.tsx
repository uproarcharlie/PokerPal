import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FormSlideout } from "@/components/ui/form-slideout";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check, Plus } from "lucide-react";

const registrationSchema = z.object({
  playerId: z.string().min(1, "Player selection is required"),
  buyIns: z.string().regex(/^\d+$/, "Must be a positive number").min(1, "At least 1 buy-in required"),
  rebuys: z.string().regex(/^\d*$/, "Must be a number").optional(),
  addons: z.string().regex(/^\d*$/, "Must be a number").optional(),
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

interface Player {
  id: string;
  name: string;
  email?: string;
}

interface RegisterPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
}

export function RegisterPlayerModal({ open, onOpenChange, tournamentId }: RegisterPlayerModalProps) {
  const { toast } = useToast();

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: ["/api/players"],
  });

  const form = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      playerId: "",
      buyIns: "1",
      rebuys: "0",
      addons: "0",
    },
  });

  const registerPlayerMutation = useMutation({
    mutationFn: async (data: RegistrationFormData) => {
      const payload = {
        playerId: data.playerId,
        buyIns: parseInt(data.buyIns),
        rebuys: parseInt(data.rebuys || '0'),
        addons: parseInt(data.addons || '0'),
      };

      const response = await apiRequest("POST", `/api/tournaments/${tournamentId}/registrations`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Player registered successfully!",
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to register player",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: RegistrationFormData) => {
    registerPlayerMutation.mutate(data);
  };

  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title="Register Player"
      description="Add a player to this tournament with their entry details."
      footer={
        <>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            data-testid="cancel-registration"
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            onClick={form.handleSubmit(onSubmit)}
            disabled={registerPlayerMutation.isPending || players.length === 0}
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
          <FormField
            control={form.control}
            name="playerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Player*</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="player-select">
                      <SelectValue placeholder="Select a player" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {players.length === 0 ? (
                      <SelectItem value="no-players" disabled>No players available</SelectItem>
                    ) : (
                      players.map((player) => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name} {player.email && `(${player.email})`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

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

          {players.length === 0 && (
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-3">
                No players found. You need to create players before registering them for tournaments.
              </p>
              <Button type="button" variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Create New Player
              </Button>
            </div>
          )}
        </form>
      </Form>
    </FormSlideout>
  );
}

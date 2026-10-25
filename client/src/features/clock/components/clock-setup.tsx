import { useState } from "react";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { ClockStructure } from "@shared/domain/clock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { useClockConfig } from "../staff-hooks";
import { StructureChooser, type StructureSource } from "./structure-chooser";

interface ClockSetupProps {
  tournament: Pick<TournamentDetailDto, "id" | "clubId">;
  timeZone: string;
}

/** A tournament without a clock: set one up from a preset, the generator or an earlier game. */
export function ClockSetup({ tournament, timeZone }: ClockSetupProps) {
  const { toast } = useToast();
  const { save } = useClockConfig(tournament.id);
  const [pending, setPending] = useState<string | null>(null);

  const create = async (structure: ClockStructure, presetKey: StructureSource, choice: string) => {
    setPending(choice);
    try {
      await save.mutateAsync({ structure, presetKey, baseHash: null });
      toast({ title: "Clock set up", description: "Start it when play begins; every level can still be edited." });
    } catch (error) {
      // Someone else set it up meanwhile: their clock is now on screen (the refusal carries it).
      if (hasErrorCode(error, "CLOCK_EXISTS")) toast({ title: "The clock was already set up", description: "Someone else set it up first: here it is." });
      else toast({ title: "Could not set the clock up", description: errorMessage(error), variant: "destructive" });
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up the clock</CardTitle>
        <CardDescription>Choose a preset, build a structure, or copy one from an earlier game. You can edit every level afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <StructureChooser
          clubId={tournament.clubId}
          tournamentId={tournament.id}
          timeZone={timeZone}
          labels={{ preset: "Use this", generator: "Create the clock", copy: "Copy this structure" }}
          pending={pending}
          onChoose={create}
        />
      </CardContent>
    </Card>
  );
}

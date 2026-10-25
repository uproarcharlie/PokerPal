import { describe, expect, it } from "vitest";
import type { ManagedRegistration } from "@shared/api/registrations";
import { registrationDto } from "@test/helpers/dto";
import { earlyRegistrations } from "./early-birds-card";

const START = "2026-10-23T07:00:00.000Z";
const entry = (id: string, paymentConfirmed: boolean | null, registrationTime = "2026-10-23T06:30:00.000Z"): ManagedRegistration => ({
  ...registrationDto(id, id.toUpperCase(), { registrationTime }),
  paymentConfirmed,
});

describe("earlyRegistrations (R4-CQ-04)", () => {
  it("gives the bulk bonus only to entries the desk has seen pay, as the server counts them", () => {
    const { paid, unpaid } = earlyRegistrations([entry("a", true), entry("b", false), entry("c", null), entry("d", true, "2026-10-23T07:30:00.000Z")], START);
    expect(paid.map((registration) => registration.id)).toEqual(["a"]);
    // A row whose payment was never recorded (null) has not been paid: the server's desk counts it so too.
    expect(unpaid.map((registration) => registration.id)).toEqual(["b", "c"]);
  });
});

import { describe, expect, it } from "vitest";
import { cueFor } from "../src/core/cue.ts";
import type { Tracked } from "../src/core/tracker.ts";

const hot = (x: number, y: number): Tracked => ({ heat: 0.9, bearing: { x, y, size: 0.05 }, phase: "hot", readAt: 0, centredRun: 0 });

describe("the spoken cue", () => {
    it("is silent without a Bearing", () => {
        expect(cueFor({ heat: 0.1, bearing: null, phase: "cold", readAt: 0, centredRun: 0 })).toBeNull();
    });

    it("says which way to turn the camera", () => {
        expect(cueFor(hot(0.7, 0.1))).toBe("right");
        expect(cueFor(hot(-0.7, 0.1))).toBe("left");
        expect(cueFor(hot(0.1, 0.6))).toBe("up");
        expect(cueFor(hot(0.1, -0.6))).toBe("down");
    });

    it("names the larger of two offsets", () => {
        expect(cueFor(hot(0.4, -0.9))).toBe("down");
    });

    it("says to hold still once the Target is centred", () => {
        expect(cueFor(hot(0.1, -0.1))).toBe("hold");
    });

    it("says found when the Hunt is locked", () => {
        expect(cueFor({ ...hot(0, 0), phase: "locked", centredRun: 2 })).toBe("found");
    });
});

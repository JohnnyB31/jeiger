import { describe, expect, it } from "vitest";
import { clickRate, clickVoice, clicksNow } from "../src/core/clicker.ts";

describe("the Click rate", () => {
    it("is slow with no Heat, like background radiation", () => {
        expect(clickRate(0)).toBeCloseTo(0.5);
    });

    it("reaches 40 Clicks a second at full Heat", () => {
        expect(clickRate(1)).toBeCloseTo(40);
    });

    it("rises by the same factor for each step of Heat", () => {
        // Halfway is the geometric mean of 0.5 and 40.
        expect(clickRate(0.5)).toBeCloseTo(4.4721, 3);
    });

    it("stays within its range for a Heat outside 0 to 1", () => {
        expect(clickRate(-3)).toBeCloseTo(0.5);
        expect(clickRate(7)).toBeCloseTo(40);
    });
});

describe("whether a Click falls in a stretch of time", () => {
    it("has a 1 - 1/e chance over one average interval", () => {
        // 40 Clicks a second, 25 ms: one average interval, chance 0.632.
        expect(clicksNow(1, 25, () => 0.63)).toBe(true);
        expect(clicksNow(1, 25, () => 0.64)).toBe(false);
    });

    it("never Clicks in no time at all", () => {
        expect(clicksNow(1, 0, () => 0)).toBe(false);
    });

    it("averages the Click rate over a long run", () => {
        const random = seeded(42);
        let clicks = 0;
        const stepMs = 5;
        const seconds = 200;
        for (let t = 0; t < seconds * 1000; t += stepMs) {
            if (clicksNow(0.5, stepMs, random)) clicks += 1;
        }
        // 4.47 a second, less the rare two-in-one-step that count once.
        expect(clicks / seconds).toBeGreaterThan(4.0);
        expect(clicks / seconds).toBeLessThan(4.9);
    });
});

describe("how a Click sounds", () => {
    it("is centred and at the base pitch without a Bearing", () => {
        expect(clickVoice(null)).toEqual({ pan: 0, frequency: 1200 });
    });

    it("pans with the Bearing's left and right", () => {
        expect(clickVoice({ x: -0.8, y: 0 }).pan).toBeCloseTo(-0.8);
    });

    it("rises an octave at the top of the view and falls one at the bottom", () => {
        expect(clickVoice({ x: 0, y: 1 }).frequency).toBeCloseTo(2400);
        expect(clickVoice({ x: 0, y: -1 }).frequency).toBeCloseTo(600);
    });

    it("keeps the pan inside what a stereo panner accepts", () => {
        expect(clickVoice({ x: 1.4, y: 0 }).pan).toBe(1);
    });
});

/** A small deterministic generator (mulberry32), so the long run is repeatable. */
function seeded(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

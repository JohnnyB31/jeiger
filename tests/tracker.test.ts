import { describe, expect, it } from "vitest";
import { type Reading, settle, track, untracked } from "../src/core/tracker.ts";

const CENTRE = { top: 0.4, bottom: 0.6, left: 0.4, right: 0.6 };
const FAR_RIGHT = { top: 0.4, bottom: 0.6, left: 0.8, right: 1 };

function reading(visible: number, box = CENTRE, boxConfidence: number | null = 1): Reading {
    return { visible, box, boxConfidence };
}

describe("a Hunt's Heat", () => {
    it("takes the first Reading as it is", () => {
        const state = track(untracked, reading(0.9), 0);
        expect(state.heat).toBeCloseTo(0.9);
    });

    it("moves halfway toward a new Reading after one half-life", () => {
        const first = track(untracked, reading(0), 0);
        const second = track(first, reading(1), 350);
        expect(second.heat).toBeCloseTo(0.5);
    });

    it("holds while Readings are fresh, then fades once they stop", () => {
        const state = track(untracked, reading(0.8), 0);
        expect(settle(state, 1000).heat).toBeCloseTo(0.8);
        // Stale after 1.5 s; one fade half-life (500 ms) later it has halved.
        expect(settle(state, 2000).heat).toBeCloseTo(0.4);
    });
});

describe("a Hunt's Bearing", () => {
    it("is absent while the Target is probably not in view, whatever the box says", () => {
        const state = track(untracked, reading(0.1, FAR_RIGHT), 0);
        expect(state.bearing).toBeNull();
    });

    it("points right and level for a box at the right edge", () => {
        const state = track(untracked, reading(0.9, FAR_RIGHT), 0);
        expect(state.bearing?.x).toBeCloseTo(0.8);
        expect(state.bearing?.y).toBeCloseTo(0);
    });

    it("points up for a box at the top of the Frame", () => {
        const state = track(untracked, reading(0.9, { top: 0, bottom: 0.2, left: 0.4, right: 0.6 }), 0);
        expect(state.bearing?.y).toBeCloseTo(0.8);
    });

    it("ignores the box of a Reading that says the Target is absent", () => {
        const seen = track(untracked, reading(0.95, FAR_RIGHT), 0);
        const blink = track(seen, reading(0.3, { top: 0, bottom: 0.1, left: 0, right: 0.1 }), 100);
        expect(blink.bearing?.x).toBeCloseTo(0.8);
    });

    it("moves less toward a box the Judge is unsure of", () => {
        const start = track(untracked, reading(0.9, CENTRE), 0);
        const sure = track(start, reading(0.9, FAR_RIGHT, 1), 200);
        const unsure = track(start, reading(0.9, FAR_RIGHT, 0.2), 200);
        expect(unsure.bearing!.x).toBeLessThan(sure.bearing!.x);
        expect(unsure.bearing!.x).toBeGreaterThan(0);
    });

    it("treats a missing box confidence as middling", () => {
        const start = track(untracked, reading(0.9, CENTRE), 0);
        const unknown = track(start, reading(0.9, FAR_RIGHT, null), 200);
        const middling = track(start, reading(0.9, FAR_RIGHT, 0.5), 200);
        expect(unknown.bearing!.x).toBeCloseTo(middling.bearing!.x);
    });

    it("is dropped once the Heat has faded", () => {
        const state = track(untracked, reading(0.9, FAR_RIGHT), 0);
        expect(settle(state, 1000).bearing).not.toBeNull();
        expect(settle(state, 4000).bearing).toBeNull();
    });
});

describe("a Hunt's Phase", () => {
    it("is cold before any Reading", () => {
        expect(untracked.phase).toBe("cold");
    });

    it.each([
        [0.1, "cold"],
        [0.4, "warm"],
        [0.7, "hot"],
    ])("is read off the Heat: %f is %s", (visible, phase) => {
        expect(track(untracked, reading(visible, FAR_RIGHT), 0).phase).toBe(phase);
    });

    it("locks only after two Readings in a row with the Target centred", () => {
        const one = track(untracked, reading(0.95, CENTRE), 0);
        expect(one.phase).toBe("hot");
        const two = track(one, reading(0.95, CENTRE), 200);
        expect(two.phase).toBe("locked");
    });

    it("does not lock on a Target that is off to the side", () => {
        const one = track(untracked, reading(0.95, FAR_RIGHT), 0);
        const two = track(one, reading(0.95, FAR_RIGHT), 200);
        expect(two.phase).toBe("hot");
    });

    it("lets go of the lock when Readings stop", () => {
        const one = track(untracked, reading(0.95, CENTRE), 0);
        const two = track(one, reading(0.95, CENTRE), 200);
        expect(settle(two, 6000).phase).toBe("cold");
    });
});

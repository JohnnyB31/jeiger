/**
 * Turns the Judge's Readings into what a Hunt currently believes: Heat,
 * Bearing and Phase (CONTEXT.md).
 *
 * Two functions, both pure:
 *   - `track(state, reading, atMs)` folds one Reading in.
 *   - `settle(state, atMs)` is the belief at a later moment with no new
 *     Reading: unchanged while Readings are fresh, fading once they stop, so
 *     a stalled network goes quiet instead of clicking "hot" forever.
 *
 * Times are milliseconds on any one clock. A Reading's box is believed only
 * when that Reading says the Target is probably visible: Jev answers a Box
 * question with a box even when the Target is absent.
 */

/** Edges as fractions of the Frame, measured from its top-left corner. */
export type Box = { top: number; bottom: number; left: number; right: number };

export type Reading = {
    /** Probability from 0 to 1 that the Target is visible in the Frame. */
    visible: number;
    box: Box;
    /** From 0 to 1, or null when the Judge gave none. */
    boxConfidence: number | null;
};

export type Bearing = {
    /** -1 at the left edge of the view, 0 in the centre, 1 at the right edge. */
    x: number;
    /** -1 at the bottom of the view, 0 in the centre, 1 at the top. */
    y: number;
    /** Fraction of the view the Target fills, from 0 to 1. */
    size: number;
};

export type Phase = "cold" | "warm" | "hot" | "locked";

export type Tracked = {
    heat: number;
    bearing: Bearing | null;
    phase: Phase;
    /** When the last Reading was folded in, or null before the first. */
    readAt: number | null;
    /** How many Readings in a row had the Target centred. */
    centredRun: number;
};

export const untracked: Tracked = { heat: 0, bearing: null, phase: "cold", readAt: null, centredRun: 0 };

const HEAT_HALF_LIFE_MS = 350;
const BEARING_HALF_LIFE_MS = 250;
const STALE_AFTER_MS = 1500;
const FADE_HALF_LIFE_MS = 500;
/** At or above this, a Reading's box (and the Bearing) is believed. */
const BELIEVE = 0.5;
const WARM = 0.25;
const HOT = 0.6;
const LOCK_HEAT = 0.8;
/** How far from the centre (in Bearing units) still counts as centred. */
const CENTRED_WITHIN = 0.25;
const LOCK_AFTER_READINGS = 2;
const UNKNOWN_CONFIDENCE = 0.5;

export function track(state: Tracked, reading: Reading, atMs: number): Tracked {
    const before = settle(state, atMs);
    const elapsed = before.readAt === null ? null : Math.max(0, atMs - before.readAt);

    const heat = elapsed === null ? reading.visible : approach(before.heat, reading.visible, elapsed, HEAT_HALF_LIFE_MS);

    let bearing: Bearing | null;
    if (reading.visible >= BELIEVE) {
        const seen = bearingOf(reading.box);
        if (before.bearing === null || elapsed === null) {
            bearing = seen;
        } else {
            const trust = reading.boxConfidence ?? UNKNOWN_CONFIDENCE;
            const pull = trust * approach(0, 1, elapsed, BEARING_HALF_LIFE_MS);
            bearing = {
                x: before.bearing.x + pull * (seen.x - before.bearing.x),
                y: before.bearing.y + pull * (seen.y - before.bearing.y),
                size: before.bearing.size + pull * (seen.size - before.bearing.size),
            };
        }
    } else {
        bearing = heat >= BELIEVE ? before.bearing : null;
    }

    const centred = reading.visible >= BELIEVE && bearing !== null && isCentred(bearing);
    const centredRun = centred ? before.centredRun + 1 : 0;
    return { heat, bearing, centredRun, readAt: atMs, phase: phaseOf(heat, centredRun) };
}

export function settle(state: Tracked, atMs: number): Tracked {
    if (state.readAt === null) return state;
    const staleFor = atMs - state.readAt - STALE_AFTER_MS;
    if (staleFor <= 0) return state;

    const heat = state.heat * 0.5 ** (staleFor / FADE_HALF_LIFE_MS);
    const bearing = heat >= BELIEVE ? state.bearing : null;
    const centredRun = bearing === null ? 0 : state.centredRun;
    return { ...state, heat, bearing, centredRun, phase: phaseOf(heat, centredRun) };
}

/** `from` moved toward `to`: halfway after one half-life, three quarters after two. */
function approach(from: number, to: number, elapsedMs: number, halfLifeMs: number): number {
    return to + (from - to) * 0.5 ** (elapsedMs / halfLifeMs);
}

function bearingOf(box: Box): Bearing {
    return {
        x: (box.left + box.right) - 1,
        y: 1 - (box.top + box.bottom),
        size: Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top),
    };
}

function isCentred(bearing: Bearing): boolean {
    return Math.abs(bearing.x) <= CENTRED_WITHIN && Math.abs(bearing.y) <= CENTRED_WITHIN;
}

function phaseOf(heat: number, centredRun: number): Phase {
    if (heat >= LOCK_HEAT && centredRun >= LOCK_AFTER_READINGS) return "locked";
    if (heat >= HOT) return "hot";
    if (heat >= WARM) return "warm";
    return "cold";
}

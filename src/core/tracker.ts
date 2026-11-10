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
 * question with a box even when the Target is absent. And there is a Bearing
 * only while the Heat says so too, so one stray hot Reading points nowhere.
 *
 * The Bearing is smoothed, for the sound. Locking is not: it looks at each
 * Reading's own box, so the lock lets go the moment the Target leaves the
 * centre, however slowly the Bearing follows.
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
/** Frames go out about one a second (the server's Frame gap), so a belief is fresh for a few of those. */
const STALE_AFTER_MS = 3000;
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
/** How much of a box the Bearing follows even when the Judge gives it no confidence, so it cannot freeze. */
const LEAST_TRUST = 0.2;

export function track(state: Tracked, reading: Reading, atMs: number): Tracked {
    const before = settle(state, atMs);
    const elapsed = before.readAt === null ? null : Math.max(0, atMs - before.readAt);

    const heat = elapsed === null ? reading.visible : approach(before.heat, reading.visible, elapsed, HEAT_HALF_LIFE_MS);

    const seen = isBelieved(reading) ? bearingOf(reading.box) : null;
    let bearing: Bearing | null;
    if (heat < BELIEVE) {
        bearing = null;
    } else if (seen === null) {
        bearing = before.bearing;
    } else if (before.bearing === null || elapsed === null) {
        bearing = seen;
    } else {
        const trust = LEAST_TRUST + (1 - LEAST_TRUST) * (reading.boxConfidence ?? UNKNOWN_CONFIDENCE);
        const pull = trust * approach(0, 1, elapsed, BEARING_HALF_LIFE_MS);
        bearing = {
            x: before.bearing.x + pull * (seen.x - before.bearing.x),
            y: before.bearing.y + pull * (seen.y - before.bearing.y),
        };
    }

    const centred = bearing !== null && seen !== null && isCentred(seen);
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

/** Whether this Reading says the Target is probably in the Frame, so that its box means something. */
export function isBelieved(reading: Reading): boolean {
    return reading.visible >= BELIEVE;
}

/** Whether a Bearing is close enough to the middle of the view to count toward locking. */
export function isCentred(bearing: Bearing): boolean {
    return Math.abs(bearing.x) <= CENTRED_WITHIN && Math.abs(bearing.y) <= CENTRED_WITHIN;
}

function bearingOf(box: Box): Bearing {
    return { x: box.left + box.right - 1, y: 1 - (box.top + box.bottom) };
}

function phaseOf(heat: number, centredRun: number): Phase {
    if (heat >= LOCK_HEAT && centredRun >= LOCK_AFTER_READINGS) return "locked";
    if (heat >= HOT) return "hot";
    if (heat >= WARM) return "warm";
    return "cold";
}

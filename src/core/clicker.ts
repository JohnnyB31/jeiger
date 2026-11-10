/**
 * The counter's voice: how often it Clicks for a given Heat, and how one
 * Click sounds for a given Bearing (CONTEXT.md).
 *
 * Clicks are a Poisson process, as in a real Geiger counter: random
 * intervals around an average rate. The caller asks `clicksNow` once per
 * short stretch of time (a few milliseconds), so the rate can change between
 * stretches and the Clicks never wait for a Reading.
 */
import type { Bearing } from "./tracker.ts";

const BACKGROUND_PER_SECOND = 0.5;
const FULL_HEAT_PER_SECOND = 40;
const BASE_FREQUENCY_HZ = 1200;

/** Average Clicks per second: 0.5 with no Heat, 40 at full Heat, exponential in between. */
export function clickRate(heat: number): number {
    const clamped = Math.min(1, Math.max(0, heat));
    return BACKGROUND_PER_SECOND * (FULL_HEAT_PER_SECOND / BACKGROUND_PER_SECOND) ** clamped;
}

/**
 * Whether a Click falls within `elapsedMs` at this Heat. `random` returns a
 * number in [0, 1), as `Math.random` does. At most one Click per call, so
 * keep the stretches short next to the average interval (25 ms at full Heat).
 */
export function clicksNow(heat: number, elapsedMs: number, random: () => number): boolean {
    const chance = 1 - Math.exp((-clickRate(heat) * elapsedMs) / 1000);
    return random() < chance;
}

export type ClickVoice = {
    /** Stereo position, -1 (left) to 1 (right). */
    pan: number;
    frequency: number;
};

/** Pan follows the Bearing's left and right; pitch rises an octave toward the top of the view. */
export function clickVoice(bearing: Bearing | null): ClickVoice {
    if (bearing === null) return { pan: 0, frequency: BASE_FREQUENCY_HZ };
    const pan = Math.min(1, Math.max(-1, bearing.x));
    const height = Math.min(1, Math.max(-1, bearing.y));
    return { pan, frequency: BASE_FREQUENCY_HZ * 2 ** height };
}

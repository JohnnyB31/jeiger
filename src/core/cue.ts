/** The one word Jeiger says aloud for where a Hunt stands, for hunting without looking at the screen. */
import type { Tracked } from "./tracker.ts";

export type Cue = "left" | "right" | "up" | "down" | "hold" | "found";

/** Offsets up to this far from the centre (in Bearing units) need no turning. */
const CLOSE_ENOUGH = 0.25;

/** Null while there is no Bearing: nothing useful to say. */
export function cueFor(state: Tracked): Cue | null {
    if (state.phase === "locked") return "found";
    if (state.bearing === null) return null;
    const { x, y } = state.bearing;
    if (Math.abs(x) <= CLOSE_ENOUGH && Math.abs(y) <= CLOSE_ENOUGH) return "hold";
    if (Math.abs(x) >= Math.abs(y)) return x > 0 ? "right" : "left";
    return y > 0 ? "up" : "down";
}

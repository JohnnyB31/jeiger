/**
 * Sizes a picture so Jev accepts it. Jev rejects (it never resizes) an image
 * with a side under 280 or over 1568 pixels, so both a Frame and an Exemplar
 * go through here before they are sent:
 * https://docs.typesafe.ai/images.md#limits
 */

export const JEV_MIN_SIDE = 280;
export const JEV_MAX_SIDE = 1568;

export type FrameFit = {
    /** The part of the source picture to keep, in source pixels. */
    crop: { x: number; y: number; width: number; height: number };
    /** The size to draw that part at. */
    width: number;
    height: number;
};

/**
 * The short side becomes `shortSide` pixels (kept within Jev's limits), the
 * long side follows the aspect ratio. A picture so elongated that its long
 * side would pass the maximum loses its two ends: the middle is kept.
 */
export function fitFrame(sourceWidth: number, sourceHeight: number, shortSide = 320): FrameFit {
    const short = Math.min(JEV_MAX_SIDE, Math.max(JEV_MIN_SIDE, Math.round(shortSide)));
    const landscape = sourceWidth >= sourceHeight;
    const sourceShort = landscape ? sourceHeight : sourceWidth;
    const sourceLong = landscape ? sourceWidth : sourceHeight;

    const keptLong = Math.min(sourceLong, Math.round((sourceShort * JEV_MAX_SIDE) / short));
    const offset = Math.round((sourceLong - keptLong) / 2);
    const long = Math.min(JEV_MAX_SIDE, Math.round((short * keptLong) / sourceShort));

    return landscape
        ? { crop: { x: offset, y: 0, width: keptLong, height: sourceShort }, width: long, height: short }
        : { crop: { x: 0, y: offset, width: sourceShort, height: keptLong }, width: short, height: long };
}

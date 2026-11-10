import { describe, expect, it } from "vitest";
import { fitFrame } from "../src/core/frame-fit.ts";

describe("fitting a picture to Jev's image limits", () => {
    it("scales a landscape camera picture to a 320 pixel short side", () => {
        expect(fitFrame(1280, 720)).toEqual({
            crop: { x: 0, y: 0, width: 1280, height: 720 },
            width: 569,
            height: 320,
        });
    });

    it("scales a portrait phone picture the same way", () => {
        const fit = fitFrame(720, 1280);
        expect([fit.width, fit.height]).toEqual([320, 569]);
    });

    it("scales a picture below Jev's 280 pixel minimum up", () => {
        const fit = fitFrame(160, 120);
        expect([fit.width, fit.height]).toEqual([427, 320]);
    });

    it("takes the requested short side", () => {
        const fit = fitFrame(4000, 3000, 768);
        expect([fit.width, fit.height]).toEqual([1024, 768]);
    });

    it("crops the middle out of a picture too wide for Jev's 1568 pixel maximum", () => {
        // 8:1. At a 320 short side the long side may be 1568, so 4.9:1 is kept.
        expect(fitFrame(4000, 500)).toEqual({
            crop: { x: 775, y: 0, width: 2450, height: 500 },
            width: 1568,
            height: 320,
        });
    });

    it("crops the middle out of a picture too tall", () => {
        const fit = fitFrame(500, 4000);
        expect(fit.crop).toEqual({ x: 0, y: 775, width: 500, height: 2450 });
        expect([fit.width, fit.height]).toEqual([320, 1568]);
    });

    it("keeps a requested short side inside Jev's limits", () => {
        expect(fitFrame(1000, 1000, 100).width).toBe(280);
        expect(fitFrame(1000, 1000, 5000).width).toBe(1568);
    });
});

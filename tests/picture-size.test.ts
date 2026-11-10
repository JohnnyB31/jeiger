import { describe, expect, it } from "vitest";
import { pictureSize } from "../src/server/picture-size.ts";

// Real files: a 1 x 1 PNG, and the header of a 3 x 2 baseline JPEG as an encoder writes it
// (quantisation table before the start-of-frame segment).
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG_3X2 = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xdb, 0x00, 0x05, 0x00, 0x01, 0x02,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
]);

describe("reading a picture's size from its header", () => {
    it("reads a PNG", () => {
        expect(pictureSize(PNG_1X1)).toEqual({ format: "png", width: 1, height: 1 });
    });

    it("reads a JPEG, past the segments that come before its size", () => {
        expect(pictureSize(JPEG_3X2)).toEqual({ format: "jpg", width: 3, height: 2 });
    });

    it("reads a progressive JPEG, whose size sits in another kind of segment", () => {
        const progressive = Uint8Array.from(JPEG_3X2);
        progressive[28] = 0xc2;
        expect(pictureSize(progressive)).toEqual({ format: "jpg", width: 3, height: 2 });
    });

    it("has no size for what is not a PNG or JPEG", () => {
        expect(pictureSize(new TextEncoder().encode("GIF89a, or anything else"))).toBeNull();
        expect(pictureSize(new Uint8Array(0))).toBeNull();
    });

    it("has no size for a file cut off before it", () => {
        expect(pictureSize(JPEG_3X2.slice(0, 30))).toBeNull();
        expect(pictureSize(PNG_1X1.subarray(0, 20))).toBeNull();
    });
});

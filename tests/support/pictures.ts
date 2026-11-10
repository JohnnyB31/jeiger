/**
 * Picture files for tests: the smallest bytes that carry a format and a size.
 * They hold no pixels, which is enough for the Fake Jev (it reads a
 * picture's header, as it never looks at the picture itself).
 */
import type { Picture } from "../../src/server/judge.ts";

export function jpeg(width: number, height: number): Picture {
    const startOfFrame = [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00];
    const jfif = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    return { format: "jpg", bytes: Uint8Array.from([0xff, 0xd8, ...jfif, ...startOfFrame, 0xff, 0xd9]) };
}

export function png(width: number, height: number): Picture {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    bytes.set([8, 2, 0, 0, 0], 24);
    return { format: "png", bytes };
}

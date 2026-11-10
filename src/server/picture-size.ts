/** Reads a PNG's or JPEG's format and pixel size from its header, without decoding it. */

export type PictureSize = { format: "png" | "jpg"; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Null when the bytes are neither a PNG nor a JPEG, or stop before the size. */
export function pictureSize(bytes: Uint8Array): PictureSize | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
        if (bytes.length < 24) return null;
        return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };
    }

    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let at = 2;
    while (at + 9 <= bytes.length) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1]!;
        // A start-of-frame segment holds the size. C4, C8 and CC share its range but are other things.
        const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (startOfFrame) return { format: "jpg", height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
        at += 2 + view.getUint16(at + 2);
    }
    return null;
}

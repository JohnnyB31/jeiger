import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeJev, startFakeJev } from "../src/server/fake-jev.ts";
import { jpeg, png } from "./support/pictures.ts";

/**
 * The Fake Jev against Jev's own documentation: each request here is one the
 * documentation shows or names, with the outcome it states.
 */
let jev: FakeJev;
beforeEach(async () => {
    jev = await startFakeJev({ answer: () => ({ visible: 0.98, box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 }, boxConfidence: 0.92 }) });
});
afterEach(() => jev.close());

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function post(body: unknown, headers: Record<string, string> = { "TypeSafe-Danger-Zone-Images": "true" }) {
    return fetch(`${jev.url}/v1/systemone`, {
        method: "POST",
        headers: { authorization: "Bearer key", "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}

/** The Box guide's mug request, with the photo as base64 in the JSON. */
function mugRequest(photo = jpeg(1024, 768)) {
    return {
        model: "jev-latest",
        state: { photo: "6e1d0b7c-kitchen" },
        assets: { "6e1d0b7c-kitchen": { type: "image", format: "jpg", data_base64: base64(photo.bytes) } },
        questions: {
            mug_visible: { type: "noul", instructions: "Is there a coffee mug in `photo`?" },
            mug: { type: "box", instructions: "the coffee mug in `photo`" },
        },
    };
}

describe("the Fake Jev", () => {
    it("answers the Box guide's request in the documented shape", async () => {
        const response = await post(mugRequest());

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            model: "jev-1.14.0",
            answers: {
                mug_visible: { type: "noul", noul: 0.98 },
                mug: { type: "box", box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 }, confidence: 0.92 },
            },
            usage: { input_tokens: expect.any(Number), output_tokens: expect.any(Number) },
        });
    });

    it("takes a picture inside a question's instructions", async () => {
        const request = mugRequest();
        const response = await post({
            ...request,
            assets: { ...request.assets, "9a21c7d3-badge": { format: "png", data_base64: base64(png(300, 300).bytes) } },
            questions: { same: { type: "noul", instructions: "Is the mug in `photo` the one in this picture: 9a21c7d3-badge?" } },
        });

        expect(response.status).toBe(200);
        expect(jev.requests[0]?.pictures.map((picture) => picture.at)).toEqual(["state.photo", "questions.same.instructions"]);
    });

    it("refuses a picture without the images header", async () => {
        expect((await post(mugRequest(), {})).status).toBe(400);
    });

    it("refuses an asset nothing refers to", async () => {
        const request = mugRequest();
        const response = await post({ ...request, state: { photo: "no picture here" } });
        expect(response.status).toBe(400);
    });

    it("refuses a Box question on Jev 1.13", async () => {
        expect((await post({ ...mugRequest(), model: "jev-1.13.0" })).status).toBe(400);
    });

    it("refuses a picture with a side under 280 pixels", async () => {
        expect((await post(mugRequest(jpeg(279, 600)))).status).toBe(400);
    });

    it("refuses a picture with a side over 1568 pixels as too large", async () => {
        expect((await post(mugRequest(jpeg(1569, 600)))).status).toBe(413);
    });

    it("refuses base64 with a data: prefix", async () => {
        const request = mugRequest();
        const response = await post({
            ...request,
            assets: { "6e1d0b7c-kitchen": { format: "jpg", data_base64: `data:image/jpeg;base64,${base64(jpeg(600, 600).bytes)}` } },
        });
        expect(response.status).toBe(400);
    });

    it("takes as long to answer as it is told to", async () => {
        const slow = await startFakeJev({ answerAfterMs: 80 });
        try {
            const startedAt = performance.now();
            const response = await fetch(`${slow.url}/v1/systemone`, {
                method: "POST",
                headers: { authorization: "Bearer key", "content-type": "application/json", "TypeSafe-Danger-Zone-Images": "true" },
                body: JSON.stringify(mugRequest()),
            });

            expect(response.status).toBe(200);
            // A timer may fire a millisecond or two early.
            expect(performance.now() - startedAt).toBeGreaterThanOrEqual(77);
        } finally {
            await slow.close();
        }
    });
});

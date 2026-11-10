import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { type FakeJev, startFakeJev } from "../src/server/fake-jev.ts";
import { createHunts } from "../src/server/hunts.ts";
import { jevJudge } from "../src/server/judge.ts";
import { jpeg, png } from "./support/pictures.ts";

/**
 * The whole server over real HTTP: the app, the Hunts, the Jev Judge, and the
 * Fake Jev where `api.typesafe.ai` would be.
 */
const BOX = { top: 0.1, bottom: 0.3, left: 0.6, right: 0.9 };

let jev: FakeJev;
let server: Server;
let url: string;

async function start(budgetUsd = 1) {
    const hunts = createHunts({ judge: jevJudge({ apiKey: "test-key", baseUrl: jev.url }), budgetUsd });
    server = createServer(createApp({ hunts, simulated: false, budgetUsd }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
    jev = await startFakeJev({ answer: () => ({ visible: 0.85, box: BOX, boxConfidence: 0.7 }) });
    await start();
});
afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await jev.close();
});

async function openHunt(fields: { words?: string; exemplar?: Uint8Array<ArrayBuffer> }) {
    const form = new FormData();
    if (fields.words !== undefined) form.set("words", fields.words);
    if (fields.exemplar !== undefined) form.set("exemplar", new Blob([fields.exemplar], { type: "image/png" }));
    return fetch(`${url}/api/hunts`, { method: "POST", body: form });
}

function sendFrame(huntId: string, bytes: Uint8Array<ArrayBuffer> = jpeg(569, 320).bytes) {
    return fetch(`${url}/api/hunts/${huntId}/readings`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: bytes });
}

describe("the Jeiger server", () => {
    it("opens a Hunt for words and reads a Frame for it", async () => {
        const opened = await openHunt({ words: "my keys" });
        expect(opened.status).toBe(201);
        const { id } = await opened.json();

        const response = await sendFrame(id);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            reading: { visible: 0.85, box: BOX, boxConfidence: 0.7 },
            spent: { inputTokens: expect.any(Number), usd: expect.any(Number) },
            model: "jev-1.14.0",
        });
        expect(jev.requests[0]?.questions.where?.instructions).toBe("my keys in `frame`");
    });

    it("opens a Hunt for an Exemplar and sends it along with every Frame", async () => {
        const { id } = await (await openHunt({ exemplar: png(400, 300).bytes })).json();

        await sendFrame(id);

        expect(jev.requests[0]?.pictures).toEqual([
            { at: "state.frame", format: "jpg", width: 569, height: 320 },
            { at: "state.exemplar", format: "png", width: 400, height: 300 },
        ]);
    });

    it("refuses a Hunt without a Target", async () => {
        const response = await openHunt({ words: " " });

        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe("no_target");
    });

    it("refuses an Exemplar that is not a PNG or JPEG", async () => {
        const response = await openHunt({ exemplar: new TextEncoder().encode("GIF89a") });

        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe("not_a_picture");
    });

    it("refuses a Frame that is not a PNG or JPEG, before it costs anything", async () => {
        const { id } = await (await openHunt({ words: "my keys" })).json();

        const response = await sendFrame(id, new TextEncoder().encode("not a picture"));

        expect(response.status).toBe(400);
        expect(jev.attempts).toBe(0);
    });

    it("answers 404 for a Hunt it does not know", async () => {
        const response = await sendFrame("nope");

        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe("unknown_hunt");
    });

    it("answers 402 once the Budget is spent", async () => {
        await new Promise((resolve) => server.close(resolve));
        await start(0);
        const { id } = await (await openHunt({ words: "my keys" })).json();

        const response = await sendFrame(id);

        expect(response.status).toBe(402);
        expect((await response.json()).error.code).toBe("budget_spent");
    });

    it("answers 503 while Jev is busy, so the page slows down", async () => {
        const { id } = await (await openHunt({ words: "my keys" })).json();
        jev.failNext(429);

        const response = await sendFrame(id);

        expect(response.status).toBe(503);
        expect((await response.json()).error.code).toBe("judge_busy");
    });

    it("passes on Jev's reason when Jev refuses a Frame", async () => {
        const { id } = await (await openHunt({ words: "my keys" })).json();

        const response = await sendFrame(id, jpeg(100, 100).bytes);

        expect(response.status).toBe(502);
        const { error } = await response.json();
        expect(error.code).toBe("judge_refused");
        expect(error.message).toMatch(/280/);
    });

    it("tells the page how it is set up", async () => {
        const response = await fetch(`${url}/api/config`);

        expect(await response.json()).toEqual({ simulated: false, budgetUsd: 1, maxWords: 200 });
    });

    it("serves the page", async () => {
        const response = await fetch(`${url}/`);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toMatch(/^text\/html/);
        expect(await response.text()).toContain("<title>Jeiger</title>");
    });

    it("serves the shared TypeScript to the browser as JavaScript", async () => {
        const response = await fetch(`${url}/core/tracker.ts`);
        const script = await response.text();

        expect(response.headers.get("content-type")).toMatch(/^text\/javascript/);
        expect(script).toContain("export function track(");
        expect(script).not.toMatch(/export type|: Tracked/);
        // It runs as it stands: no type syntax is left in it.
        const module = await import(`data:text/javascript;base64,${Buffer.from(script).toString("base64")}`);
        expect(module.untracked.phase).toBe("cold");
    });

    it("serves nothing outside the page and the shared code", async () => {
        for (const path of ["/server/judge.ts", "/core/../server/judge.ts", "/web/%2e%2e/server/judge.ts", "/package.json"]) {
            expect((await fetch(`${url}${path}`)).status, path).toBe(404);
        }
    });
});

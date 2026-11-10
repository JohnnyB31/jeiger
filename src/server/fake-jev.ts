/**
 * The Fake Jev (CONTEXT.md): a local HTTP server that stands in for
 * `https://api.typesafe.ai`, for the tests and for `npm run demo`.
 *
 * It enforces the request rules Jev documents, so a request the real API
 * would reject fails here too:
 *   - the images header, the asset fields and the "every asset is referenced"
 *     rule: https://docs.typesafe.ai/images.md
 *   - the picture limits (PNG or JPEG, each side 280 to 1568 pixels, 16 MiB)
 *   - Box questions need Jev 1.14: https://docs.typesafe.ai/primitives/box.md
 *
 * It does NOT look at the picture. Its answers come from the `answer`
 * function: by default `wandering`, a Target that drifts through the view and
 * in and out of sight. Its token counts are invented (Jev has not published
 * how it counts a picture).
 *
 * It takes JSON bodies with base64 pictures only (not multipart), and Noul
 * and Box questions only. That is all Jeiger sends.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Reading } from "../core/tracker.ts";
import { pictureSize } from "./picture-size.ts";

/** One request the Fake Jev accepted, as far as a test cares about it. */
export type Asked = {
    model: string;
    questions: Record<string, { type: string; instructions: string }>;
    /** Every place a picture is used, with the path of the string that names it. */
    pictures: { at: string; format: "png" | "jpg"; width: number; height: number }[];
};

export type FakeJev = {
    /** Pass as the Judge's `baseUrl`. */
    url: string;
    /** The accepted requests, oldest first. */
    requests: Asked[];
    /** Every request received, accepted or not. */
    attempts: number;
    /** Replace the function that decides the answers. */
    answerWith(answer: () => Reading): void;
    /** Answer the next request with this HTTP status instead (429 and 529 are Jev's "busy"). */
    failNext(status: number): void;
    close(): Promise<void>;
};

const MODELS_WITH_BOX = ["jev-1.14.0", "jev-latest", "jev-preview"];
const MODELS = [...MODELS_WITH_BOX, "jev-1.13.0"];
// Jev's limits, written out again here on purpose: the fake must not agree with the page by sharing its constants.
const MIN_SIDE = 280;
const MAX_SIDE = 1568;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export async function startFakeJev(options: { answer?: () => Reading } = {}): Promise<FakeJev> {
    let answer = options.answer ?? (() => wandering(Date.now()));
    let failWith: number | null = null;

    const server = createServer(async (request, response) => {
        const reply = (status: number, body: unknown) => {
            response.writeHead(status, { "content-type": "application/json" });
            response.end(JSON.stringify(body));
        };
        try {
            if (request.method !== "POST" || request.url !== "/v1/systemone") return reply(404, { detail: "Not Found" });
            fake.attempts += 1;
            if (failWith !== null) {
                const status = failWith;
                failWith = null;
                return reply(status, { detail: `The Fake Jev was told to fail with ${status}.` });
            }

            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of request) {
                size += chunk.length;
                if (size > MAX_BODY_BYTES) throw new Refusal(413, "The body is over 32 MiB.");
                chunks.push(chunk);
            }
            const asked = accept(request.headers, Buffer.concat(chunks).toString("utf8"));
            fake.requests.push(asked);

            const reading = answer();
            const answers: Record<string, unknown> = {};
            for (const [name, question] of Object.entries(asked.questions)) {
                answers[name] =
                    question.type === "noul"
                        ? { type: "noul", noul: reading.visible }
                        : { type: "box", box: reading.box, confidence: reading.boxConfidence };
            }
            const pixels = asked.pictures.reduce((sum, picture) => sum + picture.width * picture.height, 0);
            reply(200, {
                model: "jev-1.14.0",
                answers,
                usage: { input_tokens: 60 + Math.round(pixels / 750), output_tokens: 21 },
            });
        } catch (error) {
            if (error instanceof Refusal) return reply(error.status, { detail: error.detail });
            reply(500, { detail: String(error) });
        }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const fake: FakeJev = {
        url: `http://127.0.0.1:${port}`,
        requests: [],
        attempts: 0,
        answerWith(next) {
            answer = next;
        },
        failNext(status) {
            failWith = status;
        },
        close: () =>
            new Promise((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            }),
    };
    return fake;
}

/**
 * A made-up Target for the demo: it circles the view every 7 seconds on a
 * circle that shrinks to the centre and grows back every 17, and it is out of
 * sight for part of every 20. So a demo passes through every Phase, locked
 * included. The box keeps moving while the Target is out of sight, as Jev's
 * does: a Box answer is always a box.
 */
export function wandering(atMs: number): Reading {
    const seconds = atMs / 1000;
    const turn = (period: number) => (2 * Math.PI * seconds) / period;
    const visible = Math.min(0.98, Math.max(0.02, 0.5 + 0.7 * Math.sin(turn(20))));
    const reach = Math.abs(Math.sin(turn(34)));
    const x = 0.5 + 0.36 * reach * Math.cos(turn(7));
    const y = 0.5 + 0.3 * reach * Math.sin(turn(7));
    return {
        visible,
        box: { top: y - 0.12, bottom: y + 0.12, left: x - 0.1, right: x + 0.1 },
        boxConfidence: 0.4 + 0.5 * visible,
    };
}

class Refusal extends Error {
    readonly status: number;
    readonly detail: unknown;
    constructor(status: number, detail: unknown) {
        super(typeof detail === "string" ? detail : JSON.stringify(detail));
        this.status = status;
        this.detail = detail;
    }
}

function accept(headers: Record<string, string | string[] | undefined>, text: string): Asked {
    const key = /^Bearer\s+(\S+)$/.exec(String(headers.authorization ?? ""))?.[1];
    if (!key) {
        // What the real API answered to a missing key on 2026-11-10 (its documentation says 401).
        throw new Refusal(403, { error_type: "authentication_error", message: "Must supply an API key! Check your request and try again." });
    }
    if (!String(headers["content-type"] ?? "").startsWith("application/json")) {
        throw new Refusal(415, "The Fake Jev takes application/json bodies only.");
    }

    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Refusal(400, "The body is not JSON.");
    }
    if (!isRecord(body)) throw new Refusal(422, "The body must be an object.");
    const { model, state, questions } = body;
    const assets = body.assets ?? {};
    if (typeof model !== "string" || !MODELS.includes(model)) throw new Refusal(422, `Unknown model: ${String(model)}`);
    if (state === undefined) throw new Refusal(422, "state is required.");
    if (!isRecord(questions) || Object.keys(questions).length === 0) throw new Refusal(422, "questions needs at least one question.");
    if (!isRecord(assets)) throw new Refusal(422, "assets must be an object.");

    const asked: Asked = { model, questions: {}, pictures: [] };
    let hasBox = false;
    for (const [name, question] of Object.entries(questions)) {
        if (!isRecord(question) || typeof question.instructions !== "string") {
            throw new Refusal(422, `questions.${name} needs instructions (the Fake Jev takes them as one string).`);
        }
        if (question.type !== "noul" && question.type !== "box") {
            throw new Refusal(422, `questions.${name}: the Fake Jev answers noul and box questions only.`);
        }
        if (question.type === "box") {
            hasBox = true;
            if (question.criteria !== undefined) throw new Refusal(422, `questions.${name}: a Box takes no criteria.`);
        }
        asked.questions[name] = { type: question.type, instructions: question.instructions };
    }

    const keys = Object.keys(assets);
    if ((hasBox || keys.length > 0) && headers["typesafe-danger-zone-images"] !== "true") {
        throw new Refusal(400, "Images are not turned on: send the TypeSafe-Danger-Zone-Images: true header.");
    }
    if (hasBox && !MODELS_WITH_BOX.includes(model)) throw new Refusal(400, "Box questions need Jev 1.14.");
    if (hasBox && keys.length === 0) throw new Refusal(400, "A Box question needs an image in the request.");

    const sizes = new Map(keys.map((key) => [key, acceptedPicture(key, assets[key])]));
    const strings: { at: string; text: string }[] = [];
    collectStrings(state, "state", strings);
    for (const [name, question] of Object.entries(questions)) {
        collectStrings((question as Record<string, unknown>).instructions, `questions.${name}.instructions`, strings);
        collectStrings((question as Record<string, unknown>).criteria, `questions.${name}.criteria`, strings);
    }
    for (const { at, text: value } of strings) {
        for (const [key, size] of sizes) {
            if (value.includes(key)) asked.pictures.push({ at, ...size });
        }
    }
    for (const key of keys) {
        if (!strings.some(({ text: value }) => value.includes(key))) {
            throw new Refusal(400, `The asset ${key} is not referenced in the state, instructions or criteria.`);
        }
    }
    return asked;
}

/** The format and size of one asset's picture. Throws a Refusal for an asset Jev would reject. */
function acceptedPicture(key: string, asset: unknown) {
    if (key.trim() === "") throw new Refusal(400, "A reference can't be empty.");
    if (!isRecord(asset)) throw new Refusal(422, `assets.${key} must be an object.`);
    if (asset.type !== undefined && asset.type !== "image") throw new Refusal(422, `assets.${key}.type must be "image".`);
    const { data_base64: data, format } = asset;
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
        throw new Refusal(400, `assets.${key}.data_base64 must be standard base64 with padding, no whitespace and no data: prefix.`);
    }
    if (format !== "png" && format !== "jpg" && format !== "jpeg") {
        throw new Refusal(400, `assets.${key}.format must be "png", "jpg" or "jpeg".`);
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_FILE_BYTES) throw new Refusal(413, `assets.${key} is over 16 MiB.`);
    const size = pictureSize(bytes);
    if (size === null) throw new Refusal(400, `assets.${key} is not a PNG or JPEG.`);
    if (size.format !== (format === "png" ? "png" : "jpg")) throw new Refusal(400, `assets.${key} is not a ${format}.`);
    if (size.width < MIN_SIDE || size.height < MIN_SIDE) {
        throw new Refusal(400, `assets.${key} is ${size.width} x ${size.height}: each side must be at least ${MIN_SIDE} pixels.`);
    }
    if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
        throw new Refusal(413, `assets.${key} is ${size.width} x ${size.height}: each side must be at most ${MAX_SIDE} pixels.`);
    }
    return size;
}

/** Every string under `value` (object keys are not values: Jev does not replace references in them). */
function collectStrings(value: unknown, at: string, into: { at: string; text: string }[]): void {
    if (typeof value === "string") into.push({ at, text: value });
    else if (Array.isArray(value)) value.forEach((item, index) => collectStrings(item, `${at}[${index}]`, into));
    else if (isRecord(value)) for (const [key, item] of Object.entries(value)) collectStrings(item, `${at}.${key}`, into);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

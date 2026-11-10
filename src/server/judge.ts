/**
 * The Judge (CONTEXT.md): given a Target and a Frame, a Reading.
 *
 * `jevJudge` is the real one. It asks TypeSafe's Jev two questions about the
 * Frame in one request: a Noul ("is the Target visible?") and a Box ("where
 * is it?"). Jev's image input is experimental ("Dreamer-ready"): the request
 * format can change between releases, so everything Jev-shaped lives in this
 * file. docs/adr/0001 says why it speaks plain HTTP and JSON.
 *
 * A failed request is never tried again here: by the time a retry came back,
 * the camera has moved on. The caller sends the next Frame instead.
 *
 * Jev's documentation: https://docs.typesafe.ai/images.md and
 * https://docs.typesafe.ai/primitives/box.md
 */
import { randomUUID } from "node:crypto";
import type { Reading } from "../core/tracker.ts";

export type Picture = { bytes: Uint8Array<ArrayBuffer>; format: "jpg" | "png" };

/** What a Hunt looks for: words, an Exemplar, or both. Build one with `targetOf`, which sees to it that at least one is set. */
export type Target = { words: string | null; exemplar: Picture | null };

/**
 * The Target for what a person typed and the photo they showed, or null when
 * that leaves nothing to look for. The words lose their backticks: in a
 * question to Jev, backticks name a field of the state.
 */
export function targetOf(words: string | null, exemplar: Picture | null): Target | null {
    const cleaned = words?.replaceAll("`", "").replace(/\s+/g, " ").trim() || null;
    return cleaned === null && exemplar === null ? null : { words: cleaned, exemplar };
}

export type Sighting = {
    reading: Reading;
    /** What the request cost, in Jev input tokens (output tokens are free). */
    inputTokens: number;
};

export type Judge = { read(target: Target, frame: Picture): Promise<Sighting> };

/**
 * - `busy`: Jev is rate limiting, overloaded or failing (429, 529, any 5xx), or did not answer in time. Slow down.
 * - `unauthorised`: Jev does not accept the API key.
 * - `refused`: Jev rejected the request, e.g. a picture outside its limits. `message` is Jev's reason.
 * - `broken`: Jev answered with something this file cannot read. Its format may have changed.
 */
export type JudgeFailure = "busy" | "unauthorised" | "refused" | "broken";

export class JudgeError extends Error {
    readonly kind: JudgeFailure;
    constructor(kind: JudgeFailure, message: string) {
        super(message);
        this.name = "JudgeError";
        this.kind = kind;
    }
}

export const JEV_URL = "https://api.typesafe.ai";
/** Pinned: Box questions need Jev 1.14, and an alias such as jev-latest moves when a release ships. */
export const JEV_MODEL = "jev-1.14.0";
/** Dollars per input token: $0.042 per million (https://docs.typesafe.ai/models.md). */
export const JEV_USD_PER_TOKEN = 0.042 / 1_000_000;

const ANSWER_WITHIN_MS = 10_000;

export function jevJudge(options: { apiKey: string; baseUrl?: string; model?: string }): Judge {
    const url = `${options.baseUrl ?? JEV_URL}/v1/systemone`;
    const model = options.model ?? JEV_MODEL;

    return {
        async read(target, frame) {
            let response: Response;
            let text: string;
            try {
                response = await fetch(url, {
                    method: "POST",
                    headers: {
                        authorization: `Bearer ${options.apiKey}`,
                        "content-type": "application/json",
                        // Images and Box questions are off without this header.
                        "typesafe-danger-zone-images": "true",
                    },
                    body: JSON.stringify(requestFor(model, target, frame)),
                    signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
                });
                // Inside the try: the time limit also covers reading the answer.
                text = await response.text();
            } catch (error) {
                throw new JudgeError("busy", `Jev did not answer: ${error instanceof Error ? error.message : String(error)}`);
            }

            const body = parsed(text);
            if (!response.ok) throw new JudgeError(failureFor(response.status), reasonIn(body) ?? `Jev answered ${response.status}`);
            return sightingIn(body);
        },
    };
}

function requestFor(model: string, target: Target, frame: Picture) {
    // A picture is listed once under `assets`; its key stands for it wherever
    // the key appears. Jev matches keys as plain text, hence a fresh UUID each.
    const frameKey = randomUUID();
    const exemplarKey = randomUUID();
    const { words } = target;

    // Both pictures go in the state, which both questions share, so each is
    // sent to the model once. A question names one by its path in backticks.
    const state: Record<string, string> = { frame: frameKey };
    const assets: Record<string, object> = { [frameKey]: assetFor(frame) };
    let visible: string;
    let where: string;
    if (target.exemplar !== null) {
        state.exemplar = exemplarKey;
        assets[exemplarKey] = assetFor(target.exemplar);
        const hint = words ? ` (${words})` : "";
        visible = `Is the thing shown in \`exemplar\`${hint} visible in \`frame\`?`;
        where = `the thing in \`frame\` that is shown in \`exemplar\`${hint}`;
    } else {
        visible = `Is this visible in \`frame\`: ${words}?`;
        where = `${words} in \`frame\``;
    }

    return {
        model,
        state,
        assets,
        questions: {
            visible: { type: "noul", instructions: visible },
            where: { type: "box", instructions: where },
        },
    };
}

function assetFor(picture: Picture) {
    return { type: "image", format: picture.format, data_base64: Buffer.from(picture.bytes).toString("base64") };
}

function parsed(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function failureFor(status: number): JudgeFailure {
    // 429 and 529 are Jev's documented "slow down". Any other 5xx is Jev's trouble, not the request's.
    if (status === 429 || status >= 500) return "busy";
    // The documentation says 401; on 2026-11-10 the API answered 403 to a missing key.
    if (status === 401 || status === 403) return "unauthorised";
    return "refused";
}

/** Jev's error body is `{detail}`: a string, an object with a `message`, or a list of validation errors. */
function reasonIn(body: unknown): string | null {
    if (!isRecord(body)) return null;
    const { detail } = body;
    if (typeof detail === "string") return detail;
    if (isRecord(detail) && typeof detail.message === "string") return detail.message;
    return detail === undefined ? null : JSON.stringify(detail);
}

function sightingIn(body: unknown): Sighting {
    const broken = () => new JudgeError("broken", `Jev's answer is not in the expected format: ${JSON.stringify(body)?.slice(0, 300)}`);
    if (!isRecord(body) || !isRecord(body.answers) || !isRecord(body.usage)) throw broken();
    const { visible, where } = body.answers;
    if (!isRecord(visible) || !isFraction(visible.noul)) throw broken();
    if (!isRecord(where) || !isRecord(where.box)) throw broken();

    const { top, bottom, left, right } = where.box;
    if (!isFraction(top) || !isFraction(bottom) || !isFraction(left) || !isFraction(right)) throw broken();
    // The API reference allows a null confidence; the Box guide does not mention it.
    const confidence = where.confidence ?? null;
    if (confidence !== null && !isFraction(confidence)) throw broken();
    if (typeof body.usage.input_tokens !== "number") throw broken();

    return {
        reading: { visible: visible.noul, box: { top, bottom, left, right }, boxConfidence: confidence },
        inputTokens: body.usage.input_tokens,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFraction(value: unknown): value is number {
    return typeof value === "number" && value >= 0 && value <= 1;
}

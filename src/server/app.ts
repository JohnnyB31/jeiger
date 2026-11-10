/**
 * Jeiger's HTTP surface: the API the page calls, and the page itself.
 *
 *   POST /api/hunts                 form fields `words` and/or `exemplar` (a PNG or JPEG file) -> 201 {id}
 *   POST /api/hunts/:id/readings    body: one Frame, a PNG or JPEG                              -> 200 HuntReading
 *   GET  /api/config                                                                            -> {simulated, budgetUsd, maxWords}
 *
 * A failure is `{error: {code, message}}`; `message` is written for the person
 * holding the camera. 503 `judge_busy` means "send the next Frame later".
 *
 * The page is `src/web`, and it imports `src/core` as it stands: a `.ts` file
 * is served with its types stripped (docs/adr/0002). Only files in those two
 * folders are served.
 */
import { readFileSync, readdirSync } from "node:fs";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { HuntError, type HuntFailure, type Hunts, MAX_WORDS } from "./hunts.ts";
import { JudgeError, type JudgeFailure, type Picture } from "./judge.ts";
import { pictureSize } from "./picture-size.ts";

export type AppOptions = {
    hunts: Hunts;
    /** True when the Judge is the Fake Jev: the page says so. */
    simulated: boolean;
    budgetUsd: number;
};

const MAX_EXEMPLAR_FORM_BYTES = 8 * 1024 * 1024;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

const HUNT_STATUS: Record<HuntFailure, number> = { no_target: 400, words_too_long: 400, unknown_hunt: 404, budget_spent: 402 };
const JUDGE_STATUS: Record<JudgeFailure, number> = { busy: 503, unauthorised: 502, refused: 502, broken: 502 };
const JUDGE_MESSAGE: Record<JudgeFailure, (reason: string) => string> = {
    busy: () => "Jev is busy. Slowing down.",
    unauthorised: () => "Jev does not accept the API key. Check TYPESAFE_API_KEY and restart Jeiger.",
    refused: (reason) => `Jev refused the picture: ${reason}`,
    broken: () => "Jev answered in a format Jeiger does not know. Its image input may have changed.",
};

const CONTENT_TYPES: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    ts: "text/javascript; charset=utf-8",
    svg: "image/svg+xml",
};

class Rejected extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function createApp(options: AppOptions): RequestListener {
    const files = servedFiles();

    return async (request, response) => {
        const json = (status: number, body: unknown) => {
            response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
            response.end(JSON.stringify(body));
        };
        const { pathname } = new URL(request.url ?? "/", "http://jeiger");

        try {
            if (request.method === "GET" && pathname === "/api/config") {
                return json(200, { simulated: options.simulated, budgetUsd: options.budgetUsd, maxWords: MAX_WORDS });
            }
            if (request.method === "POST" && pathname === "/api/hunts") {
                const form = await formOf(request);
                const words = form.get("words");
                const exemplar = form.get("exemplar");
                const id = options.hunts.open({
                    words: typeof words === "string" ? words : null,
                    // A browser sends an empty file for a file field nobody filled.
                    exemplar: exemplar instanceof File && exemplar.size > 0 ? pictureOf(new Uint8Array(await exemplar.arrayBuffer())) : null,
                });
                return json(201, { id });
            }
            const readings = /^\/api\/hunts\/([^/]+)\/readings$/.exec(pathname);
            if (request.method === "POST" && readings) {
                const frame = pictureOf(await bodyOf(request, MAX_FRAME_BYTES));
                return json(200, await options.hunts.read(readings[1]!, frame));
            }
            if (pathname.startsWith("/api/")) throw new Rejected(404, "not_found", "No such endpoint.");

            const file = request.method === "GET" ? files.get(pathname) : undefined;
            if (file === undefined) {
                response.writeHead(404, { "content-type": "text/plain" });
                return response.end("Not found");
            }
            serve(file, response);
        } catch (error) {
            if (error instanceof Rejected) return json(error.status, { error: { code: error.code, message: error.message } });
            if (error instanceof HuntError) return json(HUNT_STATUS[error.kind], { error: { code: error.kind, message: error.message } });
            if (error instanceof JudgeError) {
                console.error(`Judge ${error.kind}: ${error.message}`);
                return json(JUDGE_STATUS[error.kind], { error: { code: `judge_${error.kind}`, message: JUDGE_MESSAGE[error.kind](error.message) } });
            }
            console.error(error);
            json(500, { error: { code: "internal", message: "Jeiger tripped over something. See the server's log." } });
        }
    };
}

/** URL path -> file, for every file in src/web and src/core. Anything else is a 404. */
function servedFiles(): Map<string, string> {
    const files = new Map<string, string>();
    for (const folder of ["web", "core"]) {
        const directory = fileURLToPath(new URL(`../${folder}/`, import.meta.url));
        for (const name of readdirSync(directory)) files.set(`/${folder}/${name}`, directory + name);
    }
    files.set("/", files.get("/web/index.html")!);
    return files;
}

function serve(file: string, response: ServerResponse): void {
    const extension = file.slice(file.lastIndexOf(".") + 1);
    // Read on every request, so an edit shows on reload. A prototype's trade.
    const body = extension === "ts" ? stripTypeScriptTypes(readFileSync(file, "utf8")) : readFileSync(file);
    response.writeHead(200, { "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
}

function pictureOf(bytes: Uint8Array<ArrayBuffer>): Picture {
    // Only "is it a picture at all" is checked here. Jev owns its size limits and words the refusal itself.
    const size = pictureSize(bytes);
    if (size === null) throw new Rejected(400, "not_a_picture", "That is not a PNG or JPEG picture.");
    return { bytes, format: size.format };
}

async function bodyOf(request: IncomingMessage, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) throw new Rejected(413, "too_large", "That picture is too large.");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function formOf(request: IncomingMessage): Promise<FormData> {
    const body = await bodyOf(request, MAX_EXEMPLAR_FORM_BYTES);
    try {
        return await new Response(body, { headers: { "content-type": request.headers["content-type"] ?? "" } }).formData();
    } catch {
        throw new Rejected(400, "not_a_form", "Send the Target as form data.");
    }
}

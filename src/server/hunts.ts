/**
 * The open Hunts and the Budget they share (CONTEXT.md).
 *
 * A Hunt is opened with its Target and then fed Frames; each Frame costs one
 * request to the Judge. The Budget is one sum for the whole running server,
 * not per Hunt: it is the guard against an open tab left pointing at a wall.
 * It is checked before each request, so the request that crosses it is still
 * made and the spend ends slightly above it.
 * Everything is kept in memory and gone on restart.
 */
import { randomUUID } from "node:crypto";
import type { Reading } from "../core/tracker.ts";
import { JEV_USD_PER_TOKEN, type Judge, type Picture, type Target, targetOf } from "./judge.ts";

/** What the server has paid the Judge so far, over all Hunts. */
export type Spent = { inputTokens: number; usd: number };

export type HuntReading = { reading: Reading; spent: Spent };

export type HuntFailure = "no_target" | "words_too_long" | "unknown_hunt" | "budget_spent";

export class HuntError extends Error {
    readonly kind: HuntFailure;
    constructor(kind: HuntFailure, message: string) {
        super(message);
        this.name = "HuntError";
        this.kind = kind;
    }
}

export type Hunts = {
    readonly budgetUsd: number;
    /**
     * Opens a Hunt for what the person typed and the photo they showed, and
     * returns its id. Throws a HuntError when that names no Target.
     */
    open(words: string | null, exemplar: Picture | null): string;
    /** Rejects with a HuntError (unknown Hunt, Budget spent) or with the Judge's JudgeError. */
    read(huntId: string, frame: Picture): Promise<HuntReading>;
};

export const MAX_WORDS = 200;
/** Exemplars are held in memory, so only the most recent Hunts are kept. */
const HUNTS_KEPT = 20;

export function createHunts(options: { judge: Judge; budgetUsd: number }): Hunts {
    const targets = new Map<string, Target>();
    let inputTokens = 0;
    const spent = (): Spent => ({ inputTokens, usd: inputTokens * JEV_USD_PER_TOKEN });

    return {
        budgetUsd: options.budgetUsd,

        open(words, exemplar) {
            const target = targetOf(words, exemplar);
            if (target === null) throw new HuntError("no_target", "Say what to look for, or show a photo of it.");
            if (target.words !== null && target.words.length > MAX_WORDS) {
                throw new HuntError("words_too_long", `Describe it in at most ${MAX_WORDS} characters.`);
            }
            const id = randomUUID();
            targets.set(id, target);
            // A Map keeps insertion order, so its first key is the oldest Hunt.
            if (targets.size > HUNTS_KEPT) targets.delete(targets.keys().next().value!);
            return id;
        },

        async read(huntId, frame) {
            const target = targets.get(huntId);
            if (target === undefined) throw new HuntError("unknown_hunt", "This Hunt is over. Start a new one.");
            if (spent().usd >= options.budgetUsd) {
                throw new HuntError("budget_spent", `The Budget of $${options.budgetUsd.toFixed(2)} is spent. Restart Jeiger to go on.`);
            }
            const sighting = await options.judge.read(target, frame);
            inputTokens += sighting.inputTokens;
            return { reading: sighting.reading, spent: spent() };
        },
    };
}

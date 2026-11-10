import { describe, expect, it } from "vitest";
import { HuntError, createHunts } from "../src/server/hunts.ts";
import type { Judge, Target } from "../src/server/judge.ts";
import { jpeg, png } from "./support/pictures.ts";

const FRAME = jpeg(569, 320);
const READING = { visible: 0.9, box: { top: 0.2, bottom: 0.4, left: 0.2, right: 0.4 }, boxConfidence: 0.8 };

/** A Judge that always sees the Target, at a fixed price, and remembers what it was asked. */
function seeingJudge(inputTokens = 1_000_000) {
    const asked: Target[] = [];
    const judge: Judge = {
        async read(target) {
            asked.push(target);
            return { reading: READING, inputTokens };
        },
    };
    return { judge, asked };
}

describe("Hunts", () => {
    it("reads a Frame for the Hunt's Target", async () => {
        const { judge, asked } = seeingJudge();
        const hunts = createHunts({ judge, budgetUsd: 1 });

        const hunt = hunts.open("  my keys ", null);
        const { reading } = await hunts.read(hunt, FRAME);

        expect(reading).toEqual(READING);
        expect(asked).toEqual([{ words: "my keys", exemplar: null }]);
    });

    it("keeps each Hunt's own Target", async () => {
        const { judge, asked } = seeingJudge();
        const hunts = createHunts({ judge, budgetUsd: 1 });
        const sock = png(400, 400);

        const keys = hunts.open("my keys", null);
        const socks = hunts.open(null, sock);
        await hunts.read(socks, FRAME);
        await hunts.read(keys, FRAME);

        expect(asked).toEqual([
            { words: null, exemplar: sock },
            { words: "my keys", exemplar: null },
        ]);
    });

    it("says what has been spent, at Jev's price of $0.042 per million tokens", async () => {
        const hunts = createHunts({ judge: seeingJudge(1_000_000).judge, budgetUsd: 1 });
        const hunt = hunts.open("my keys", null);

        await hunts.read(hunt, FRAME);
        const second = await hunts.read(hunt, FRAME);

        expect(second.spent.inputTokens).toBe(2_000_000);
        expect(second.spent.usd).toBeCloseTo(0.084);
    });

    it("stops reading once the Budget is spent, across all Hunts", async () => {
        const hunts = createHunts({ judge: seeingJudge(1_000_000).judge, budgetUsd: 0.05 });
        const first = hunts.open("my keys", null);
        const second = hunts.open("my wallet", null);

        await hunts.read(first, FRAME); // $0.042
        await hunts.read(second, FRAME); // $0.084: over

        await expect(hunts.read(first, FRAME)).rejects.toMatchObject({ kind: "budget_spent" });
    });

    it("refuses a Hunt without a Target", () => {
        const hunts = createHunts({ judge: seeingJudge().judge, budgetUsd: 1 });

        expect(() => hunts.open("   ", null)).toThrowError(HuntError);
        expect(() => hunts.open(null, null)).toThrowError(expect.objectContaining({ kind: "no_target" }));
    });

    it("refuses words that are nothing but backticks and spaces", () => {
        const hunts = createHunts({ judge: seeingJudge().judge, budgetUsd: 1 });

        expect(() => hunts.open(" `` ` ", null)).toThrowError(expect.objectContaining({ kind: "no_target" }));
    });

    it("refuses words longer than 200 characters", () => {
        const hunts = createHunts({ judge: seeingJudge().judge, budgetUsd: 1 });

        expect(() => hunts.open("x".repeat(201), null)).toThrowError(expect.objectContaining({ kind: "words_too_long" }));
    });

    it("does not know a Hunt it never opened", async () => {
        const hunts = createHunts({ judge: seeingJudge().judge, budgetUsd: 1 });

        await expect(hunts.read("nope", FRAME)).rejects.toMatchObject({ kind: "unknown_hunt" });
    });

    it("forgets the oldest Hunt beyond the 20 it keeps", async () => {
        const hunts = createHunts({ judge: seeingJudge().judge, budgetUsd: 1 });
        const first = hunts.open("my keys", null);
        for (let i = 0; i < 20; i += 1) hunts.open(`thing ${i}`, null);

        await expect(hunts.read(first, FRAME)).rejects.toMatchObject({ kind: "unknown_hunt" });
    });
});

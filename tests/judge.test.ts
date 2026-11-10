import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeJev, startFakeJev } from "../src/server/fake-jev.ts";
import { JudgeError, jevJudge } from "../src/server/judge.ts";
import { jpeg, png } from "./support/pictures.ts";

const FRAME = jpeg(569, 320);
const MUG = { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 };

let jev: FakeJev;
beforeEach(async () => {
    jev = await startFakeJev({ answer: () => ({ visible: 0.9, box: MUG, boxConfidence: 0.92 }) });
});
afterEach(() => jev.close());

const judge = () => jevJudge({ apiKey: "test-key", baseUrl: jev.url });

describe("the Jev Judge", () => {
    it("reads a Frame for a Target given in words", async () => {
        const sighting = await judge().read({ words: "the coffee mug", exemplar: null }, FRAME);

        expect(sighting.reading).toEqual({ visible: 0.9, box: MUG, boxConfidence: 0.92 });
        expect(sighting.model).toBe("jev-1.14.0");
        expect(sighting.inputTokens).toBeGreaterThan(0);
    });

    it("asks Jev whether the Target is visible and where, about the one Frame", async () => {
        await judge().read({ words: "the coffee mug", exemplar: null }, FRAME);

        const [asked] = jev.requests;
        expect(asked?.model).toBe("jev-1.14.0");
        expect(asked?.questions).toEqual({
            visible: { type: "noul", instructions: "Is this visible in `frame`: the coffee mug?" },
            where: { type: "box", instructions: "the coffee mug in `frame`" },
        });
        expect(asked?.pictures).toEqual([{ at: "state.frame", format: "jpg", width: 569, height: 320 }]);
    });

    it("sends an Exemplar once, in the state, and points both questions at it", async () => {
        await judge().read({ words: null, exemplar: png(400, 300) }, FRAME);

        const [asked] = jev.requests;
        expect(asked?.pictures).toEqual([
            { at: "state.frame", format: "jpg", width: 569, height: 320 },
            { at: "state.exemplar", format: "png", width: 400, height: 300 },
        ]);
        expect(asked?.questions).toEqual({
            visible: { type: "noul", instructions: "Is the thing shown in `exemplar` visible in `frame`?" },
            where: { type: "box", instructions: "the thing in `frame` that is shown in `exemplar`" },
        });
    });

    it("adds the words to an Exemplar when the Target has both", async () => {
        await judge().read({ words: "a striped sock", exemplar: png(400, 300) }, FRAME);

        expect(jev.requests[0]?.questions.visible?.instructions).toBe(
            "Is the thing shown in `exemplar` (a striped sock) visible in `frame`?",
        );
    });

    it("keeps backticks out of the questions, where they would name a field of the state", async () => {
        await judge().read({ words: "the `exemplar` label", exemplar: null }, FRAME);

        expect(jev.requests[0]?.questions.where?.instructions).toBe("the exemplar label in `frame`");
    });

    it("passes on a box that came without a confidence", async () => {
        jev.answerWith(() => ({ visible: 0.7, box: MUG, boxConfidence: null }));

        const sighting = await judge().read({ words: "the coffee mug", exemplar: null }, FRAME);

        expect(sighting.reading.boxConfidence).toBeNull();
    });

    it.each([429, 529])("reports Jev as busy on a %i, without asking again", async (status) => {
        jev.failNext(status);

        const failure = await judge().read({ words: "the coffee mug", exemplar: null }, FRAME).catch((error) => error);

        expect(failure).toBeInstanceOf(JudgeError);
        expect(failure.kind).toBe("busy");
        expect(jev.requests).toHaveLength(0);
        expect(jev.attempts).toBe(1);
    });

    it("reports a key Jev does not accept", async () => {
        const stranger = jevJudge({ apiKey: "", baseUrl: jev.url });

        const failure = await stranger.read({ words: "the coffee mug", exemplar: null }, FRAME).catch((error) => error);

        expect(failure.kind).toBe("unauthorised");
    });

    it("reports a Frame Jev refuses, with Jev's reason", async () => {
        const failure = await judge().read({ words: "the coffee mug", exemplar: null }, jpeg(200, 200)).catch((error) => error);

        expect(failure.kind).toBe("refused");
        expect(failure.message).toMatch(/280/);
    });

    it("reports an answer it cannot read as broken", async () => {
        jev.answerWith(() => ({ visible: 4, box: MUG, boxConfidence: 1 }));

        const failure = await judge().read({ words: "the coffee mug", exemplar: null }, FRAME).catch((error) => error);

        expect(failure.kind).toBe("broken");
    });
});

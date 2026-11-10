/**
 * Starts Jeiger.
 *
 *   TYPESAFE_API_KEY    the Jev API key. Without it, pass --fake-jev.
 *   --fake-jev          use the Fake Jev: no key, no cost, a made-up Target.
 *   PORT                default 4747
 *   JEIGER_BUDGET_USD   the Budget, default 0.25
 *   JEV_MODEL           default jev-1.14.0
 */
import { createServer } from "node:http";
import { createApp } from "./app.ts";
import { startFakeJev } from "./fake-jev.ts";
import { createHunts } from "./hunts.ts";
import { JEV_MODEL, jevJudge } from "./judge.ts";

const fakeJev = process.argv.includes("--fake-jev");
const apiKey = process.env.TYPESAFE_API_KEY;
if (!fakeJev && !apiKey) {
    console.error("Set TYPESAFE_API_KEY to hunt with Jev, or run `npm run demo` to try Jeiger with a made-up Target.");
    process.exit(1);
}

const budgetUsd = Number(process.env.JEIGER_BUDGET_USD ?? 0.25);
if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    console.error("JEIGER_BUDGET_USD must be a number of dollars, such as 0.25.");
    process.exit(1);
}

const judge = fakeJev
    ? jevJudge({ apiKey: "fake", baseUrl: (await startFakeJev()).url })
    : jevJudge({ apiKey: apiKey!, model: process.env.JEV_MODEL ?? JEV_MODEL });
// The Fake Jev's token counts are invented and nobody pays for them: no Budget.
const hunts = createHunts({ judge, budgetUsd: fakeJev ? Infinity : budgetUsd });

const port = Number(process.env.PORT ?? 4747);
createServer(createApp({ hunts, fakeJev })).listen(port, () => {
    console.log(`Jeiger is listening on http://localhost:${port}${fakeJev ? " (Fake Jev: nothing looks at the camera)" : ""}`);
    console.log("A browser gives a page the camera only on localhost or over HTTPS.");
});

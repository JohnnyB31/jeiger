/**
 * Starts Jeiger.
 *
 *   TYPESAFE_API_KEY    the Jev API key. Without it, pass --simulate.
 *   --simulate          use the Fake Jev: no key, no cost, a made-up Target.
 *   PORT                default 4747
 *   JEIGER_BUDGET_USD   the Budget, default 0.25
 *   JEV_MODEL           default jev-1.14.0
 */
import { createServer } from "node:http";
import { createApp } from "./app.ts";
import { startFakeJev } from "./fake-jev.ts";
import { createHunts } from "./hunts.ts";
import { JEV_MODEL, jevJudge } from "./judge.ts";

const simulated = process.argv.includes("--simulate");
const apiKey = process.env.TYPESAFE_API_KEY;
if (!simulated && !apiKey) {
    console.error("Set TYPESAFE_API_KEY to hunt with Jev, or run `npm run demo` to try Jeiger with a made-up Target.");
    process.exit(1);
}

const budgetUsd = Number(process.env.JEIGER_BUDGET_USD ?? 0.25);
if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    console.error("JEIGER_BUDGET_USD must be a number of dollars, such as 0.25.");
    process.exit(1);
}

const judge = simulated
    ? jevJudge({ apiKey: "fake", baseUrl: (await startFakeJev()).url })
    : jevJudge({ apiKey: apiKey!, model: process.env.JEV_MODEL ?? JEV_MODEL });

const port = Number(process.env.PORT ?? 4747);
createServer(createApp({ hunts: createHunts({ judge, budgetUsd }), simulated, budgetUsd })).listen(port, () => {
    console.log(`Jeiger is listening on http://localhost:${port}${simulated ? " (simulated Judge)" : ""}`);
    console.log("A browser gives a page the camera only on localhost or over HTTPS.");
});

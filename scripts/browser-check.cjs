/**
 * Drives the page through a whole Hunt in headless Chromium with a fake
 * camera, against the Fake Jev, and fails if the Hunt does not behave.
 *
 *   node scripts/browser-check.cjs
 *
 * Needs Playwright with its Chromium (`npm i -D playwright && npx playwright
 * install chromium`). It is not in package.json: this is the only thing that
 * uses it, and it is a large download for a prototype. Takes about a minute,
 * because the Fake Jev's made-up Target needs that long to pass through every
 * Phase.
 */
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { chromium } = require("playwright");

const PORT = 4799;
const URL = `http://localhost:${PORT}/`;

async function main() {
    const server = spawn(process.execPath, [join(__dirname, "../src/server/main.ts"), "--fake-jev"], {
        env: { ...process.env, PORT: String(PORT) },
        stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise((resolve) => server.stdout.once("data", resolve));
    const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

    try {
        const page = await (await browser.newContext({ permissions: ["camera"] })).newPage();
        const problems = [];
        page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
        // A refused request (the 400 below is meant) also logs "Failed to load resource": statuses are judged here instead.
        page.on("console", (message) => {
            if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) problems.push(`console: ${message.text()}`);
        });
        page.on("response", (response) => response.status() >= 500 && problems.push(`HTTP ${response.status()} ${response.url()}`));
        const hunt = () => page.evaluate(() => ({
            phase: document.documentElement.dataset.phase,
            readings: Number(document.documentElement.dataset.readings ?? 0),
            boxShown: !document.getElementById("box").hidden,
            button: document.getElementById("hunt").textContent,
            status: document.getElementById("status").textContent,
        }));

        await page.goto(URL);

        // A Hunt needs a Target.
        await page.fill("#words", "   ");
        await page.click("#hunt");
        await page.waitForFunction(() => document.getElementById("status").textContent !== "");
        check((await hunt()).button === "Hunt", "a Hunt without a Target does not start");

        // A Hunt passes through every Phase, and shows a box only while it believes one.
        await page.fill("#words", "my keys");
        await page.click("#hunt");
        const phases = new Set();
        let boxWhileCold = false;
        let lockedWithoutBox = false;
        const until = Date.now() + 60_000;
        while (Date.now() < until && phases.size < 4) {
            const now = await hunt();
            phases.add(now.phase);
            if (now.phase === "cold" && now.boxShown) boxWhileCold = true;
            if (now.phase === "locked" && !now.boxShown) lockedWithoutBox = true;
            await page.waitForTimeout(100);
        }
        check(!boxWhileCold, "no box is shown while the Hunt is cold");
        check(!lockedWithoutBox, "the box is shown while the Hunt is locked");
        check(phases.size === 4, `the Hunt passed through cold, warm, hot and locked (saw: ${[...phases].join(", ")})`);

        // Stop ends it: no more Readings, and the counter goes cold.
        await page.click("#hunt");
        await page.waitForTimeout(700);
        const stopped = await hunt();
        await page.waitForTimeout(700);
        const later = await hunt();
        check(later.readings === stopped.readings, "no Frame is sent after Stop");
        check(later.phase === "cold" && !later.boxShown && later.button === "Hunt", "the counter is cold after Stop");

        check(problems.length === 0, `no errors on the page (${problems.join("; ") || "none"})`);
    } finally {
        await browser.close();
        server.kill();
    }
}

function check(holds, what) {
    console.log(`${holds ? "ok  " : "FAIL"} ${what}`);
    if (!holds) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

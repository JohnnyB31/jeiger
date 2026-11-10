/**
 * Renders src/web/icon.svg to the PNGs a phone's home screen wants. Run it
 * after changing the SVG:
 *
 *   node scripts/render-icons.cjs
 *
 * Needs Playwright with its Chromium, as scripts/browser-check.cjs does.
 */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("playwright");

const WEB = join(__dirname, "../src/web");
// 192 and 512 are the web app manifest's; 180 is the iPhone's home screen icon.
const SIZES = [180, 192, 512];

(async () => {
    const svg = readFileSync(join(WEB, "icon.svg"), "utf8");
    const browser = await chromium.launch();
    try {
        for (const size of SIZES) {
            const page = await browser.newPage({ viewport: { width: size, height: size } });
            await page.setContent(`<style>html, body { margin: 0 } svg { display: block; width: ${size}px; height: ${size}px }</style>${svg}`);
            await page.screenshot({ path: join(WEB, `icon-${size}.png`) });
            await page.close();
            console.log(`icon-${size}.png`);
        }
    } finally {
        await browser.close();
    }
})();

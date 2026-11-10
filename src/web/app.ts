/**
 * The page: camera in, Clicks out.
 *
 * Three loops run while a Hunt is on, each at its own pace:
 *   - reading: grab a Frame, send it, wait for the Reading, fold it into
 *     `tracked`, and only then grab the next Frame. One request at a time,
 *     as fast as the Judge answers.
 *   - sound: every few milliseconds, decide from the current Heat whether a
 *     Click falls now. It never waits for a Reading.
 *   - drawing: every animation frame, the needle, the box and the readout.
 *
 * All three read the belief through `settle(tracked, now)`. The logic is in
 * ../core; this file is the browser plumbing around it.
 */
import { clickRate, clicksNow, clickVoice } from "../core/clicker.ts";
import { type Cue, cueFor } from "../core/cue.ts";
import { fitFrame } from "../core/frame-fit.ts";
import { type Box, isBelieved, type Reading, settle, track, type Tracked, untracked } from "../core/tracker.ts";

const FRAME_SHORT_SIDE = 320;
const EXEMPLAR_SHORT_SIDE = 512;
/** How long the page waits before the next Frame after a busy Judge: this at first, doubling up to the longest. */
const FIRST_BACK_OFF_MS = 500;
const LONGEST_BACK_OFF_MS = 8000;
const SOUND_TICK_MS = 8;
const CUE_EVERY_MS = 1600;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $("view");
const camera = $<HTMLVideoElement>("camera");
const boxElement = $("box");
const needle = document.getElementById("needle") as unknown as SVGLineElement;
const words = $<HTMLInputElement>("words");
const exemplarInput = $<HTMLInputElement>("exemplar");
const thumb = $<HTMLImageElement>("thumb");
const huntButton = $<HTMLButtonElement>("hunt");
const status = $("status");
const soundSwitch = $<HTMLInputElement>("sound");
const voiceSwitch = $<HTMLInputElement>("voice");
const mirrorSwitch = $<HTMLInputElement>("mirror");
const lamp = $("lamp");

/** How the server is set up: {fakeJev, budgetUsd (null for no Budget), maxWords}. */
const config = await (await fetch("/api/config")).json();

function dollars(amount: number, decimals: number): string {
    return "$" + amount.toFixed(decimals);
}

let tracked: Tracked = untracked;
/** The id of the Hunt that is on, or null. A loop stops when this is no longer its Hunt. */
let huntId: string | null = null;
/** The box of the last Reading that saw the Target, as shown (mirrored if the view is). */
let shownBox: Box | null = null;
let readingsPerSecond = 0;
let readingsTaken = 0;

// ─── Starting and stopping a Hunt ───────────────────────────────────────────

$<HTMLFormElement>("target").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (huntId !== null) return stop("");
    huntButton.disabled = true;
    try {
        await start();
    } catch (error) {
        stop(error instanceof Error ? error.message : String(error));
    } finally {
        huntButton.disabled = false;
    }
});

async function start(): Promise<void> {
    // First, while this is still the button press: a browser lets a page make sound only after a gesture.
    startSound();

    // The Hunt before the camera, so that a missing Target is said before the browser asks for the camera.
    const form = new FormData();
    form.set("words", words.value);
    const photo = exemplarInput.files?.[0];
    if (photo) form.set("exemplar", await exemplarFrom(photo), "exemplar.jpg");
    const response = await fetch("/api/hunts", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error.message);
    await startCamera();

    huntId = body.id;
    tracked = untracked;
    shownBox = null;
    readingsPerSecond = 0;
    spoken = { cue: null, at: 0 };
    showStatus("");
    $("idle").hidden = true;
    huntButton.textContent = "Stop";
    huntButton.classList.add("running");
    void readLoop(body.id);
}

function stop(message: string): void {
    huntId = null;
    tracked = untracked;
    shownBox = null;
    stopCamera();
    huntButton.textContent = "Hunt";
    huntButton.classList.remove("running");
    showStatus(message);
}

function showStatus(message: string): void {
    status.textContent = message;
}

// ─── Camera and Frames ──────────────────────────────────────────────────────

async function startCamera(): Promise<void> {
    if (camera.srcObject) return;
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This page cannot reach a camera. A browser allows it only on localhost or over HTTPS.");
    }
    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
    } catch {
        throw new Error("Jeiger needs the camera. Allow it, then press Hunt again.");
    }
    camera.srcObject = stream;
    await camera.play();
    view.style.setProperty("--aspect", `${camera.videoWidth} / ${camera.videoHeight}`);
    view.style.setProperty("--ratio", String(camera.videoWidth / camera.videoHeight));
    // A camera facing the person (a laptop's) reads naturally only as a mirror.
    mirrorSwitch.checked = stream.getVideoTracks()[0]?.getSettings().facingMode !== "environment";
    applyMirror();
}

/** No Hunt, no camera: its light goes off with the Stop button. */
function stopCamera(): void {
    if (camera.srcObject instanceof MediaStream) camera.srcObject.getTracks().forEach((track) => track.stop());
    camera.srcObject = null;
    $("idle").hidden = false;
}

mirrorSwitch.addEventListener("change", () => {
    applyMirror();
    // What the Hunt believed was in the other orientation: start it over.
    tracked = untracked;
    shownBox = null;
});
function applyMirror(): void {
    view.classList.toggle("mirrored", mirrorSwitch.checked);
}

/** The Judge always gets the picture as the camera took it; only what is shown is mirrored. */
function asShown(reading: Reading): Reading {
    if (!mirrorSwitch.checked) return reading;
    const { top, bottom, left, right } = reading.box;
    return { ...reading, box: { top, bottom, left: 1 - right, right: 1 - left } };
}

const canvas = document.createElement("canvas");

function jpegOf(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, shortSide: number, quality: number): Promise<Blob> {
    const fit = fitFrame(sourceWidth, sourceHeight, shortSide);
    canvas.width = fit.width;
    canvas.height = fit.height;
    canvas.getContext("2d")!.drawImage(source, fit.crop.x, fit.crop.y, fit.crop.width, fit.crop.height, 0, 0, fit.width, fit.height);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the picture."))), "image/jpeg", quality);
    });
}

/** Decoding applies the photo's EXIF rotation, which Jev would ignore, and the canvas turns any format into a JPEG. */
async function exemplarFrom(photo: File): Promise<Blob> {
    const bitmap = await createImageBitmap(photo).catch(() => {
        throw new Error("The browser cannot open that photo. Try a JPEG or PNG.");
    });
    return jpegOf(bitmap, bitmap.width, bitmap.height, EXEMPLAR_SHORT_SIDE, 0.85);
}

exemplarInput.addEventListener("change", showExemplar);
$("no-exemplar").addEventListener("click", () => {
    exemplarInput.value = "";
    showExemplar();
});
function showExemplar(): void {
    const photo = exemplarInput.files?.[0];
    if (thumb.src) URL.revokeObjectURL(thumb.src);
    thumb.hidden = !photo;
    $("no-exemplar").hidden = !photo;
    thumb.src = photo ? URL.createObjectURL(photo) : "";
}

// ─── The reading loop ───────────────────────────────────────────────────────

async function readLoop(id: string): Promise<void> {
    // How long to wait before the next Frame. Nothing while the Judge answers; longer and longer while it is busy.
    let backOff = 0;
    const backOffMore = () => Math.min(LONGEST_BACK_OFF_MS, Math.max(FIRST_BACK_OFF_MS, backOff * 2));
    let lastReadingAt: number | null = null;

    while (huntId === id) {
        // Taken only now that the last Frame is answered, so it is the newest picture the camera has.
        let frame: Blob;
        try {
            frame = await jpegOf(camera, camera.videoWidth, camera.videoHeight, FRAME_SHORT_SIDE, 0.7);
        } catch (error) {
            return stop(error instanceof Error ? error.message : String(error));
        }
        try {
            const response = await fetch(`/api/hunts/${id}/readings`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: frame });
            const body = await response.json();
            if (huntId !== id) return;

            if (response.ok) {
                const now = performance.now();
                const reading = asShown(body.reading);
                tracked = track(tracked, reading, now);
                if (isBelieved(reading)) shownBox = reading.box;
                if (lastReadingAt !== null) readingsPerSecond = 0.7 * readingsPerSecond + 0.3 * (1000 / (now - lastReadingAt));
                lastReadingAt = now;
                if (!config.fakeJev) $("spent").textContent = dollars(body.spent.usd, 5);
                readingsTaken += 1;
                backOff = 0;
                showStatus("");
            } else if (response.status === 503) {
                backOff = backOffMore();
                showStatus(body.error.message);
            } else {
                return stop(body.error.message);
            }
        } catch {
            // The request failed or its answer was not JSON: either way the server is not there.
            if (huntId !== id) return;
            backOff = backOffMore();
            showStatus("Lost the connection to Jeiger. Trying again.");
        }
        if (backOff > 0) await new Promise((resolve) => setTimeout(resolve, backOff));
    }
}

// ─── Sound ──────────────────────────────────────────────────────────────────

let audio: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let lockTone: GainNode | null = null;

function startSound(): void {
    if (audio) return void audio.resume();
    audio = new AudioContext();

    // A Click is 30 ms of noise, shaped per Click by a filter and a fast fade.
    noise = audio.createBuffer(1, Math.round(audio.sampleRate * 0.03), audio.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;

    // Locked is a steady tone under the Clicks.
    const tone = audio.createOscillator();
    tone.frequency.value = 880;
    lockTone = audio.createGain();
    lockTone.gain.value = 0;
    tone.connect(lockTone).connect(audio.destination);
    tone.start();

    let lastTickAt = performance.now();
    setInterval(() => {
        const now = performance.now();
        // A tab that slept wakes with a long gap: do not turn it into a burst.
        const elapsed = Math.min(100, now - lastTickAt);
        lastTickAt = now;
        const state = settle(tracked, now);
        const audible = huntId !== null && soundSwitch.checked;
        lockTone!.gain.setTargetAtTime(audible && state.phase === "locked" ? 0.05 : 0, audio!.currentTime, 0.05);
        if (huntId !== null && clicksNow(state.heat, elapsed, Math.random)) click(state, audible);
    }, SOUND_TICK_MS);
}

function click(state: Tracked, audible: boolean): void {
    lamp.classList.add("lit");
    setTimeout(() => lamp.classList.remove("lit"), 50);
    if (!audible || !audio || !noise) return;

    const voice = clickVoice(state.bearing);
    const source = audio.createBufferSource();
    source.buffer = noise;
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = voice.frequency;
    filter.Q.value = 2.5;
    const fade = audio.createGain();
    fade.gain.setValueAtTime(0.9, audio.currentTime);
    fade.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.025);
    const panner = audio.createStereoPanner();
    panner.pan.value = voice.pan;
    source.connect(filter).connect(fade).connect(panner).connect(audio.destination);
    source.start();
}

// ─── Spoken cues ────────────────────────────────────────────────────────────

let spoken: { cue: Cue | null; at: number } = { cue: null, at: 0 };

function speak(state: Tracked, now: number): void {
    const cue = cueFor(state);
    if (!voiceSwitch.checked || huntId === null || cue === null || !("speechSynthesis" in window)) return;
    // "found" is said once; a direction is repeated while it still holds.
    const due = cue !== spoken.cue || (cue !== "found" && now - spoken.at >= CUE_EVERY_MS);
    if (!due || speechSynthesis.speaking) return;
    spoken = { cue, at: now };
    speechSynthesis.speak(new SpeechSynthesisUtterance(cue));
    if (cue === "found") navigator.vibrate?.(120);
}

// ─── Drawing ────────────────────────────────────────────────────────────────

function draw(): void {
    const now = performance.now();
    const state = settle(tracked, now);

    needle.style.setProperty("--angle", `${-60 + 120 * state.heat}deg`);
    $("phase").textContent = state.phase;
    // For scripts/browser-check.cjs, which drives this page and reads how the Hunt is going.
    document.documentElement.dataset.phase = state.phase;
    document.documentElement.dataset.readings = String(readingsTaken);
    document.body.classList.toggle("locked", state.phase === "locked");
    $("rate").textContent = (huntId === null ? 0 : clickRate(state.heat)).toFixed(1);
    // `settle` leaves a fresh belief as it is, so a changed Heat means the Readings have stopped coming.
    const readingsArrive = huntId !== null && state.heat === tracked.heat;
    $("pace").textContent = (readingsArrive ? readingsPerSecond : 0).toFixed(1);

    const show = state.bearing !== null && shownBox !== null;
    boxElement.hidden = !show;
    if (show && shownBox) {
        boxElement.style.left = `${shownBox.left * 100}%`;
        boxElement.style.top = `${shownBox.top * 100}%`;
        boxElement.style.width = `${(shownBox.right - shownBox.left) * 100}%`;
        boxElement.style.height = `${(shownBox.bottom - shownBox.top) * 100}%`;
        boxElement.style.opacity = String(0.35 + 0.65 * state.heat);
    }

    speak(state, now);
    requestAnimationFrame(draw);
}

// ─── Setting up ─────────────────────────────────────────────────────────────

$("fake-jev").hidden = !config.fakeJev;
words.maxLength = config.maxWords;
// The Fake Jev's token counts are invented, so there is nothing true to show as spent.
$("spent").textContent = config.fakeJev ? "nothing" : dollars(0, 5);
if (config.budgetUsd !== null) $("budget").textContent = `of ${dollars(config.budgetUsd, 2)}`;
requestAnimationFrame(draw);

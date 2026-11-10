# Jeiger

A Geiger counter for anything you can name.

Type "my keys" (or show a photo of one sock), press Hunt, and sweep a camera around the room. The counter clicks. The more likely the thing is in view, the faster it clicks; the clicks lean left or right and rise or fall in pitch toward where it is; and when it sits in the middle of the view the counter locks on with a steady tone. You can hunt without looking at the screen at all.

![Jeiger locked onto a Target](docs/locked.png)

This is a first prototype. It is a standalone folder: it shares no code, dependencies or checks with the shop in the rest of this repository.

## Why this suits Jev

[Jev](https://docs.typesafe.ai) is TypeSafe's judgement model: it does not write text, it answers typed questions. Jev 1.14 can [look at images](https://docs.typesafe.ai/images.md). Jeiger asks it two questions about every camera frame, in one request:

| Question | Jev type | Becomes |
| - | - | - |
| Is the Target visible in this frame? | Noul, a probability from 0 to 1 | How fast the counter clicks |
| Where is it? | [Box](https://docs.typesafe.ai/primitives/box.md), four edges | Which way the clicks lean, and the box on screen |

Three properties of Jev carry the idea:

- **The answer is a number, not a sentence.** A probability can drive a click rate directly, and can be smoothed over time like any sensor signal.
- **It is cheap enough to ask continuously.** Input costs $0.042 per million tokens and output is free, so a frame every second for minutes on end costs little. How many tokens a picture costs is not published yet; the page shows what the running server has spent so far.
- **A picture can go inside the question.** "Find the thing shown in this photo" needs no words at all, which is what the Photo button does.

## Run it

Needs Node 22.18 or newer.

```bash
cd jeiger
npm install
npm run demo          # no API key: a made-up Target, to see and hear the counter
```

Open <http://localhost:4747>, type what to look for, press Hunt, and allow the camera. The demo runs on the Fake Jev: nothing looks at the camera, and a made-up Target drifts through the view so the counter passes through cold, warm, hot and locked.

With a key from TypeSafe:

```bash
TYPESAFE_API_KEY=... npm start
```

| Setting | Default | Meaning |
| - | - | - |
| `TYPESAFE_API_KEY` | none | The Jev API key. It stays on the server; the page never sees it. |
| `JEIGER_BUDGET_USD` | `0.25` | The Budget: once one running server has spent this much on Jev, Hunts stop. |
| `JEIGER_FRAME_GAP_MS` | `1000` | The least time between two requests to Jev. One a second keeps under Jev's rate limit; lower it only if your account's limit allows. |
| `JEV_MODEL` | `jev-1.14.0` | Box questions need Jev 1.14. |
| `PORT` | `4747` | |

A laptop's webcam faces you, so the picture is shown mirrored and left and right are swapped to match. Jeiger assumes that for any camera that does not say it faces away; the Mirror switch turns it off.

**On a phone:** a browser gives a page the camera only on `localhost` or over HTTPS, so opening the laptop's address from a phone will not work as it is. Put an HTTPS tunnel in front of the port, or run it on a laptop with a webcam first.

## What has and has not been tested

- `npm test` covers the tracking and click logic, the Jev request and answer handling, the Budget, and the server over real HTTP. `npm run typecheck` checks the types, the page's code included.
- `node scripts/browser-check.cjs` drives the page in headless Chromium with a fake camera through a whole Hunt, down to the locked Phase and Stop. It needs Playwright, which is not in `package.json` (the script says how to get it). The page has no other tests.
- **Jev itself has not been called.** There was no API key when this was built, so every test runs against a Fake Jev that enforces Jev's documented request rules (`src/server/fake-jev.ts`). The first run with a real key is the first real test; [ADR 0001](docs/adr/0001-jev-is-called-over-plain-http-and-has-not-been-called-for-real.md) lists what was guessed.
- So nothing here says how *well* Jev finds things, or how fast it answers. TypeSafe itself calls image input "Dreamer-ready", not production-ready.

## How it works

```
camera ──frame──▶ server ──Noul + Box──▶ Jev
                    │
   page ◀──Reading──┘
     │
     ├─ tracker   Readings → Heat, Bearing, Phase
     ├─ clicker   Heat → random Clicks; Bearing → pan and pitch
     └─ cue       Bearing → "left", "up", "hold", "found" (spoken, optional)
```

- **One frame a second, and no more.** Jev limits how many requests an account may send. The server sends at most one per second, over all open tabs together, and makes a frame that arrives sooner wait its turn.
- **Readings and Clicks run at different speeds.** A Reading arrives once a second; Clicks are generated every few milliseconds from the current Heat. So the sound stays smooth however slowly Jev answers, and it fades to background ticking if Readings stop.
- **A box is believed only when the Noul is high.** Jev answers a Box question with a box even when the Target is not there, so the box is ignored unless the same frame's "is it visible?" says yes.
- **A failed request is never retried.** By then the camera has moved, so the next frame is sent instead. When Jev says it is busy, the page slows down.

The words used here (Hunt, Target, Exemplar, Frame, Reading, Heat, Bearing, Phase, Click, Budget) are defined in [CONTEXT.md](CONTEXT.md).

| Folder | Holds |
| - | - |
| `src/core` | The logic, pure and shared by the server's tests and the browser. |
| `src/server` | The Jev client (`judge.ts`), Hunts and the Budget, the HTTP server, the Fake Jev. |
| `src/web` | The page. |
| `tests` | One file per module, except the page (`src/web`) and the entry point (`main.ts`). |
| `scripts` | The browser check. |

## Where it could go

- **Look closer when warm.** Jev's guide suggests re-asking on a crop when a Box's confidence is low. A warm Reading could trigger one sharper second look.
- **Several Targets at once.** One request can carry many questions, so "keys, wallet, glasses" could each have their own click sound.
- **A hazard sweep.** "Anything a toddler could swallow" works as a Target as it stands; a mode that logs each find with its frame would make it a checklist.
- **Short frame history.** Jev accepts several frames in one request, so "is it getting closer?" is askable.

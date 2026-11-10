# Jev is called over plain HTTP, and has not yet been called for real

Jeiger was built on 2026-11-10 without a TypeSafe API key, from Jev's documentation alone (`docs.typesafe.ai/images.md`, `primitives/box.md`, `api/system-one.md`). So the one module that talks to Jev (`src/server/judge.ts`) does it the way the documentation spells out byte for byte: a JSON body with base64 pictures, sent with `fetch`. Everything is tested against a Fake Jev that enforces the documented request rules, and the real API has only been reached far enough to see it refuse a request without a key.

## Considered options

- **The official SDK (`@typesafe-ai/sdk`).** It builds the picture references and retries 429 and 529. Rejected for now: without a key its behaviour could not be checked either, a Hunt must not retry (a retried Frame is out of date), and the fake would have had to imitate whatever the SDK sends instead of what the documentation shows.
- **Multipart upload.** The documentation recommends it, because base64 makes a picture a third larger. Rejected: a Frame is about 30 KB, and the documentation shows the multipart request only as a `curl` command, which leaves more to guess (the part headers) than the JSON example does.

## Consequences

- The first run with a real key is the first real test. If Jev answers in another shape, the Judge fails with `broken` and the page says so. The format is likely to move anyway: TypeSafe calls image input "Dreamer-ready" and says the request format, answers and limits can change between releases.
- Two things the documentation leaves open are handled both ways: a Box's `confidence` may be null (the API reference says so, the Box guide does not), and a missing key may be answered 401 (documented) or 403 (observed).
- The Fake Jev's token counts are invented, so the "Spent" readout only means something with the real Jev.

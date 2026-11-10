# No build step: the server strips the types from TypeScript on request

The Heat, Bearing and Click logic in `src/core` has to run in the browser, and it is tested in Node. Rather than add a bundler, the server serves each `.ts` file under `src/web` and `src/core` as JavaScript by removing its types when it is requested (`stripTypeScriptTypes` from `node:module`), and Node runs the server's own `.ts` files directly. One source, no build output, and an edit shows on reload.

## Consequences

- Only erasable TypeScript works: no enums, no namespaces, no parameter properties (`erasableSyntaxOnly` in `tsconfig.json` enforces it), and every import names its file with the `.ts` extension.
- Node 22.18 or newer is required, and `stripTypeScriptTypes` is still marked experimental there, so Node prints a warning on the first request.
- Files are read and stripped on every request with no caching and no minifying. That is fine for one person on localhost; a hosted Jeiger would want a real build.

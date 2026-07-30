# Convax Web Contract

`@convax/web` owns the public Convax marketing site and its responsive product
storytelling.

- Keep this app browser-only and independent from Electron and private package
  source.
- Use public product facts and links. Do not reproduce Desktop business logic.
- Keep deployment, DNS, Cloudflare bindings, and API routing in
  `@convax/deploy-cloudflare`.
- Preserve semantic HTML, keyboard access, reduced-motion behavior, and responsive
  layouts.
- Run `bun typecheck`, `bun test`, and `bun build` after changes.

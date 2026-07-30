# Convax Cloudflare Deployment Contract

`@convax/deploy-cloudflare` is the public Cloudflare composition edge for
`convax.microvoid.io`.

- Normal navigation and assets come from the built `@convax/web` application.
- Only the exact `/api` and `/api/**` path family belongs to the future API service.
- Keep API business logic in `@convax/api`; connect it here through a Cloudflare
  Service Binding and preserve the incoming `/api` path.
- Do not put secrets in source or `wrangler.jsonc`.
- Generate Worker types from Wrangler configuration instead of hand-writing `Env`.
- Run `bun typecheck`, `bun test`, and `bun build`; run a Wrangler dry run before
  production deployment.

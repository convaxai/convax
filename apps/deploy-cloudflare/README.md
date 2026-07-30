# Convax Cloudflare deployment

This private app owns the public origin at `convax.microvoid.io`.

- `/` and normal navigation are served from `../web/dist` as a Vite SPA.
- `/api` and `/api/**` run through the Worker first.
- Until `@convax/api` exists, API requests return a non-cacheable `503` response.

## Future API binding

Deploy the NestJS-compatible API Worker independently as `convax-api`, then add a
service binding to `wrangler.jsonc`:

```jsonc
{
  "services": [
    {
      "binding": "API",
      "service": "convax-api",
    },
  ],
}
```

Regenerate `worker-configuration.d.ts` with `bun run types`, then pass
`env.API` to `routeRequest`:

```ts
return await routeRequest(request, {
  assets: env.ASSETS,
  api: env.API,
})
```

The API receives the original `/api` path and query string. Configure NestJS with
the same global prefix instead of rewriting paths at the deployment edge.

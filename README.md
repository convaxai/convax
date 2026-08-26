# Convax Next

M1 is a thin authenticated Electron product over the pinned DeepSeek Harness
runtime. The desktop process supervises an independent Node `24.9.0` child;
Cordis profiles own every product capability.

## Develop

```bash
corepack yarn install --immutable
yarn dev
```

`yarn dev` builds all product plugins and opens the `default` profile. Use
`yarn start --profile compatibility` to retain the upstream Web client without
product presentation overrides.

## Headless gates

```bash
yarn check
yarn dump-config
yarn dump-config:compatibility
yarn smoke:upstream
yarn package:dir
```

`yarn check` runs the layout/version gate, product builds and typechecks, all
unit/lifecycle tests, both profile contracts, and the explained upstream
`dump-config` baseline diff.

`smoke:upstream` starts the real npm DSH runtime with both profiles, verifies
that the product-owned final security overlay defeats a hostile writable home
patch, checks the HTTP fence, kills the default child with `SIGKILL`, and
verifies a fresh token plus preserved product-owned data after restart. It does
not open a GUI.

`package:dir` creates an unsigned macOS ARM64 app and then starts its packaged
Node/DSH closure with an empty `PATH`, isolated home and working directories,
and no dependency symlink escaping the app's `Resources` directory.

The product repository contains no upstream source checkout. Runtime and
packaging use the exact `@deepseek-ai/*` npm closure recorded in
`upstream.json`. For optional source inspection, place a matching checkout
beside this repository:

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git -C ../deepseek-harness checkout b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
yarn upstream:build
```

Normal install, check, development, and packaging commands do not require that
sibling checkout.

## Product boundaries

- `compatibility`: upstream client roster, mandatory Host auth/command/desktop
  boundaries only.
- `default`: compatibility plus `appRuntime`, lifecycle consumer, and the
  documented brand-slot replacement.
- Agent mode is limited to the read-only `standard` / `code` roster; unsafe or
  user-authored preset compositions cannot bypass the Host permission posture.
- Product configuration is pure-data YAML in `app/profiles/`.
- `security.patch.yml` is the desktop-owned final overlay; desktop argv never
  accepts caller-supplied patches.
- Product data must live outside `userData/harness`; the Electron shell exposes
  no product file API.

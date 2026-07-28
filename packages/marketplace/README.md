# @convax/marketplace

Headless Marketplace contracts and strict validation for Convax hosts and
authoring tools.

## Builtin source identity

Builtin has one stable, product-defined source identity:
`BUILTIN_SOURCE_IDENTITY`. Consumers must use `builtinSourceKey()` and must not
derive a Builtin source identity from a bundle release id, product-lock
revision, artifact digest, or member list. Those values describe changing
content under the same source.

Local sources are different: each Local snapshot root has its own persisted
`sourceInstanceId`, so multiple Local sources remain independently isolated.

/**
 * DSH rc.7 declarations use explicit resource-management names while still
 * targeting ES2022. Keep this compatibility declaration scoped to DSH-facing
 * entrypoints so ordinary Agent Runtime consumers do not need an ESNext lib.
 */
declare global {
  interface Disposable {
    [Symbol.dispose](): void
  }

  interface SymbolConstructor {
    readonly dispose: unique symbol
  }
}

export {}

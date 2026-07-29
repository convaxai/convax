export function CanvasTitle({ name }: { name: string }) {
  return (
    <div
      aria-label={`Current Canvas: ${name}`}
      className="pointer-events-none flex h-11 min-w-0 items-center"
      data-canvas-title="true"
    >
      <h1 className="max-w-64 truncate text-sm font-medium text-text-primary" title={name}>
        {name}
      </h1>
    </div>
  )
}

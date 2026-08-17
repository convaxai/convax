function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;")
}

function startupDocument(input: { failed: boolean; productName: string }) {
  const productName = escapeHtml(input.productName)
  const title = input.failed ? `${productName} could not start` : `Starting ${productName}`
  const detail = input.failed
    ? "Check the terminal for diagnostics, then restart the application."
    : "Preparing your local projects and capabilities…"
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <meta name="color-scheme" content="dark light" />
    <title>${title}</title>
    <style>
      :root { color-scheme: dark light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { align-items: center; background: #111511; color: #f4f7f1; display: flex; height: 100vh; justify-content: center; margin: 0; }
      main { align-items: center; display: flex; flex-direction: column; gap: 14px; max-width: 460px; padding: 32px; text-align: center; }
      .mark { align-items: center; background: #cafb32; border-radius: 18px; color: #182000; display: flex; font-size: 22px; font-weight: 800; height: 56px; justify-content: center; width: 56px; }
      .spinner { animation: spin 900ms linear infinite; border: 2px solid #41483d; border-radius: 999px; border-top-color: #cafb32; height: 26px; width: 26px; }
      h1 { font-size: 22px; margin: 0; }
      p { color: #a9b0a4; font-size: 14px; line-height: 1.55; margin: 0; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinner { animation: none; border-top-color: #41483d; } }
    </style>
  </head>
  <body>
    <main role="status" aria-live="polite">
      <div class="mark" aria-hidden="true">C</div>
      ${input.failed ? "" : '<div class="spinner" aria-hidden="true"></div>'}
      <h1>${title}</h1>
      <p>${detail}</p>
    </main>
  </body>
</html>`
}

function dataUrl(document: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`
}

export function desktopStartupPageUrl(productName: string) {
  return dataUrl(startupDocument({ failed: false, productName }))
}

export function desktopStartupFailurePageUrl(productName: string) {
  return dataUrl(startupDocument({ failed: true, productName }))
}

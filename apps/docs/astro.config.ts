import { defineConfig } from "astro/config"
import icon from "astro-icon"
import tailwindcss from "@tailwindcss/vite"
import nimbus, { defineConfig as defineNimbusConfig } from "@cloudflare/nimbus-docs"
import { tableScroll } from "@cloudflare/nimbus-docs/markdown"

const site = process.env.DOCS_SITE ?? "http://localhost:4321"

const nimbusConfig = defineNimbusConfig({
  site,
  title: "Convax",
  description: "围绕本地项目、可编辑画布、Agent 与可安装创作能力构建的桌面可视化工作空间。",
  locale: "zh-CN",
  github: "https://github.com/convaxai/convax",
  socialImageAlt: "Convax 文档预览",
  // Nimbus 0.8.2 invokes the Windows `pagefind.cmd` shim through execFile,
  // which Node rejects with EINVAL. Production docs deploy on Linux and keep
  // Pagefind enabled; Windows validation still builds the complete static site.
  ...(process.platform === "win32" ? { search: false } : {}),
})

export default defineConfig({
  output: "static",
  // Tailwind v4 via its Vite plugin (the integration Astro recommends for
  // Tailwind v4 — replaces the PostCSS plugin, which doesn't build under
  // Astro 7's Vite 8 bundler).
  vite: {
    plugins: [tailwindcss()],
    // Keep the native Markdown engine outside Astro's prerender bundle so its
    // platform binding resolves from Sätteri's own optional dependencies.
    ssr: {
      external: ["satteri"],
    },
  },
  // Hover-prefetch link targets so full-page navigations feel instant without
  // a client-side router.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [
    icon(),
    nimbus(nimbusConfig, {
      // Authoring rules are opt-in by design — your repo, your taste. The
      // two below are the load-bearing pair: frontmatter has to validate
      // against the content schema for the page to render properly, and
      // broken internal links are 404s for your readers. Add the others
      // (heading hierarchy, code-block language, style, etc.) when you're
      // ready to enforce them — see `nimbus-docs lint --help`.
      rules: {
        "nimbus/frontmatter-shape": "error",
        "nimbus/internal-link": "error",
      },
      // Wrap wide tables so they scroll instead of overflowing the page
      // (styled by `.nb-table-scroll` in src/styles/prose.css).
      markdown: {
        hastPlugins: [tableScroll()],
      },
    }),
  ],
})

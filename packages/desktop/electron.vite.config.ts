import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ["@convax/project"],
      },
      rollupOptions: {
        input: "src/main/index.ts",
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: "src/preload/index.ts",
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
  },
})

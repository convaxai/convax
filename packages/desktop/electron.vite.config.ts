import { defineConfig } from "electron-vite"

export default defineConfig({
  main: {
    build: {
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
    build: {
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
  },
})

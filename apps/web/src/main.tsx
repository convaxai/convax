import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/inter"
import { App } from "./App"
import "./styles.css"

const root = document.getElementById("root")

if (!root) throw new Error("Convax Web root element is missing")

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

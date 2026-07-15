import "./styles.css"

const root = document.getElementById("app")
if (!(root instanceof HTMLElement)) throw new Error("App root was not found")

root.innerHTML = `
  <main class="workspace">
    <div class="mark" aria-hidden="true">
      <span></span><span></span><span></span><span></span>
    </div>
    <p class="eyebrow">Convax Desktop</p>
    <h1>Hello world.</h1>
    <p class="status"><span></span>Electron is running on ${window.convax.platform}</p>
  </main>
`

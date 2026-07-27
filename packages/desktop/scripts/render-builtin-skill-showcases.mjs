import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const desktopRoot = resolve(import.meta.dirname, "..")
const outputRoot = join(desktopRoot, "resources", "skill-showcases")
const width = 1280
const height = 720
const fps = 30
const seconds = 4.8
const frameCount = Math.round(fps * seconds)

function commandAvailable(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0
}

function rasterizeSvgFrames(frames, destination) {
  if (process.platform === "darwin" && commandAvailable("sips")) {
    execFileSync("sips", ["-s", "format", "png", ...frames, "--out", destination], { stdio: "ignore" })
    return
  }
  if (commandAvailable("rsvg-convert")) {
    for (const frame of frames) {
      const basename = frame.slice(frame.lastIndexOf("/") + 1, -4)
      execFileSync("rsvg-convert", [
        "--width",
        String(width),
        "--height",
        String(height),
        "--output",
        join(destination, `${basename}.png`),
        frame,
      ])
    }
    return
  }
  if (commandAvailable("magick")) {
    for (const frame of frames) {
      const basename = frame.slice(frame.lastIndexOf("/") + 1, -4)
      execFileSync("magick", [frame, join(destination, `${basename}.png`)])
    }
    return
  }
  throw new Error("Rendering requires macOS sips, librsvg's rsvg-convert, or ImageMagick")
}

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const mix = (from, to, amount) => from + (to - from) * amount
const smooth = (from, to, value) => {
  const amount = clamp((value - from) / (to - from))
  return amount * amount * (3 - 2 * amount)
}
const n = (value) => Number(value).toFixed(2)
const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  )

function text(value, x, y, options = {}) {
  const { anchor = "start", fill = "#f7f8fb", opacity = 1, size = 24, tracking = 0, weight = 500 } = options
  return `<text x="${n(x)}" y="${n(y)}" fill="${fill}" fill-opacity="${n(opacity)}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}" text-anchor="${anchor}">${escapeXml(value)}</text>`
}

function roundedRect(x, y, w, h, options = {}) {
  const { fill = "#101b2c", opacity = 1, radius = 20, stroke = "#26344c", strokeOpacity = 1, strokeWidth = 1 } = options
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${radius}" fill="${fill}" fill-opacity="${n(opacity)}" stroke="${stroke}" stroke-opacity="${n(strokeOpacity)}" stroke-width="${strokeWidth}"/>`
}

function pill(label, x, y, w, accent, active = true) {
  return `${roundedRect(x, y, w, 28, {
    fill: active ? accent : "#15243a",
    opacity: active ? 0.12 : 0.75,
    radius: 14,
    stroke: active ? accent : "#34465f",
    strokeOpacity: active ? 0.42 : 0.55,
  })}${text(label, x + w / 2, y + 19, {
    anchor: "middle",
    fill: active ? accent : "#8493a9",
    size: 10,
    tracking: 0.8,
    weight: 720,
  })}`
}

function checkMark(x, y, color, opacity = 1) {
  return `<path d="M${n(x)} ${n(y)} l4 4 8 -10" fill="none" stroke="${color}" stroke-opacity="${n(opacity)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
}

function header({ accent, label, subtitle, title }, progress) {
  const enter = smooth(0.02, 0.16, progress)
  return `<g opacity="${n(enter)}" transform="translate(0 ${n(mix(18, 0, enter))})">
    ${roundedRect(72, 58, 182, 34, { fill: accent, opacity: 0.13, radius: 17, stroke: accent, strokeOpacity: 0.45 })}
    <circle cx="92" cy="75" r="5" fill="${accent}"/>
    ${text("BUILT-IN SKILL", 108, 81, { fill: accent, size: 13, tracking: 1.7, weight: 730 })}
    ${text(title, 72, 145, { size: 46, tracking: -1.2, weight: 760 })}
    ${text(subtitle, 74, 181, { fill: "#9ba9bd", size: 18 })}
    ${text(label, 1208, 83, { anchor: "end", fill: "#77869d", size: 13, tracking: 1.2, weight: 650 })}
  </g>`
}

function footer(accent, labels, progress) {
  const enter = smooth(0.58, 0.8, progress)
  return `<g opacity="${n(enter)}">${labels
    .map((label, index) => {
      const x = 74 + index * 196
      const active = index === labels.length - 1
      return `${roundedRect(x, 660, 180, 30, {
        fill: active ? accent : "#142238",
        opacity: active ? 0.15 : 0.75,
        radius: 15,
        stroke: active ? accent : "#2a3a54",
        strokeOpacity: active ? 0.45 : 0.45,
      })}${text(label, x + 90, 680, {
        anchor: "middle",
        fill: active ? accent : "#a8b4c6",
        size: 12,
        tracking: 0.8,
        weight: 650,
      })}`
    })
    .join("")}</g>`
}

function shell(content, metadata, progress) {
  const sceneOpacity = smooth(0, 0.06, progress) * (1 - smooth(0.95, 1, progress))
  const scan = -180 + progress * 1680
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <radialGradient id="glow" cx="50%" cy="0%" r="90%">
        <stop offset="0%" stop-color="${metadata.accent}" stop-opacity="0.16"/>
        <stop offset="58%" stop-color="#091321" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#122037"/><stop offset="1" stop-color="#0c1626"/>
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1b2c46" stop-opacity="0.96"/><stop offset="1" stop-color="#101b2d" stop-opacity="0.96"/>
      </linearGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="16"/></filter>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#02050a" flood-opacity="0.38"/></filter>
      <filter id="small-shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#02050a" flood-opacity="0.4"/></filter>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#b9c8dc" stroke-opacity="0.035"/></pattern>
    </defs>
    <rect width="1280" height="720" fill="#08111e"/>
    <rect width="1280" height="720" fill="url(#grid)"/>
    <rect width="1280" height="720" fill="url(#glow)"/>
    <circle cx="${n(scan)}" cy="250" r="120" fill="${metadata.accent}" fill-opacity="0.045" filter="url(#soft)"/>
    <g opacity="${n(sceneOpacity)}">
      ${header(metadata, progress)}
      ${content}
      ${footer(metadata.accent, metadata.footer, progress)}
    </g>
  </svg>`
}

function shotArtwork(index, x, y, color) {
  const variants = [
    `<path d="M${x + 14} ${y + 72} q39 -52 78 0" fill="none" stroke="${color}" stroke-opacity="0.58" stroke-width="2"/><circle cx="${x + 52}" cy="${y + 54}" r="17" fill="${color}" fill-opacity="0.68"/><rect x="${x + 31}" y="${y + 70}" width="43" height="31" rx="12" fill="${color}" fill-opacity="0.38"/>`,
    `<circle cx="${x + 36}" cy="${y + 55}" r="14" fill="${color}" fill-opacity="0.72"/><circle cx="${x + 83}" cy="${y + 55}" r="14" fill="#dce4ef" fill-opacity="0.75"/><path d="M${x + 18} ${y + 95} q18 -28 36 0 M${x + 65} ${y + 95} q18 -28 36 0" fill="none" stroke="#dce4ef" stroke-opacity="0.4" stroke-width="15" stroke-linecap="round"/>`,
    `<circle cx="${x + 61}" cy="${y + 55}" r="31" fill="${color}" fill-opacity="0.2"/><circle cx="${x + 61}" cy="${y + 51}" r="21" fill="#e8edf5" fill-opacity="0.88"/><path d="M${x + 40} ${y + 55} q21 22 42 0" fill="none" stroke="${color}" stroke-width="3"/>`,
    `<rect x="${x + 24}" y="${y + 30}" width="76" height="62" rx="8" fill="${color}" fill-opacity="0.22"/><path d="M${x + 39} ${y + 77} l18 -17 12 10 14 -21 13 28z" fill="${color}" fill-opacity="0.72"/><circle cx="${x + 46}" cy="${y + 45}" r="6" fill="#f2d08d"/>`,
    `<path d="M${x + 20} ${y + 83} C${x + 45} ${y + 30} ${x + 78} ${y + 104} ${x + 106} ${y + 48}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/><circle cx="${x + 105}" cy="${y + 48}" r="8" fill="${color}"/><path d="M${x + 20} ${y + 83} l13 -2 -7 12z" fill="#dbe4ef"/>`,
  ]
  return variants[index % variants.length]
}

function canvasStoryboard(progress) {
  const accent = "#66b5ff"
  const brief = smooth(0.07, 0.25, progress)
  const canvas = smooth(0.18, 0.38, progress)
  const review = smooth(0.69, 0.86, progress)
  const shots = [
    { color: "#66b5ff", label: "01 · WIDE", note: "Establish", x: 380 },
    { color: "#9c8cff", label: "02 · TWO SHOT", note: "Pressure", x: 544 },
    { color: "#ffad72", label: "03 · CLOSE", note: "Turn", x: 708 },
    { color: "#5ed6bc", label: "04 · INSERT", note: "Reveal", x: 872 },
    { color: "#ff7f9c", label: "05 · MOVE", note: "Exit", x: 1036 },
  ]
  const connectionProgress = smooth(0.36, 0.72, progress)
  return shell(
    `
    <g opacity="${n(brief)}" filter="url(#shadow)">
      ${roundedRect(72, 218, 270, 376, { fill: "url(#surface)", radius: 24, stroke: accent, strokeOpacity: 0.27 })}
      ${text("SCRIPT BRIEF", 98, 252, { fill: "#8f9db2", size: 11, tracking: 1.4, weight: 700 })}
      ${text("The last train", 98, 294, { size: 25, weight: 720 })}
      ${text("A quiet goodbye becomes", 98, 326, { fill: "#a7b4c7", size: 13 })}
      ${text("an unexpected choice.", 98, 347, { fill: "#a7b4c7", size: 13 })}
      ${["GEOGRAPHY", "PRESSURE", "REVEAL", "EXIT"]
        .map((label, index) => {
          const visible = smooth(0.12 + index * 0.04, 0.28 + index * 0.04, progress)
          const y = 383 + index * 39
          return `<g opacity="${n(visible)}"><circle cx="105" cy="${y - 4}" r="5" fill="${accent}" fill-opacity="${0.45 + index * 0.1}"/>${text(label, 120, y, { fill: "#91a0b5", size: 11, tracking: 0.85, weight: 680 })}<rect x="206" y="${y - 11}" width="106" height="7" rx="3.5" fill="#42536d" fill-opacity="0.55"/></g>`
        })
        .join("")}
      ${pill("5 NARRATIVE BEATS", 98, 546, 184, accent)}
    </g>
    <g opacity="${n(canvas)}">
      ${roundedRect(360, 218, 848, 376, { fill: "#0b1627", radius: 24, stroke: "#29405d", strokeOpacity: 0.85 })}
      ${text("ACTIVE CANVAS · SHOT SEQUENCE", 386, 250, { fill: "#8493aa", size: 11, tracking: 1.2, weight: 700 })}
      ${pill("REVISION 18", 1067, 231, 115, accent, false)}
      <path d="M456 413 H1112" stroke="#324661" stroke-width="2" stroke-dasharray="7 8"/>
      <path d="M456 413 H${n(456 + 656 * connectionProgress)}" stroke="${accent}" stroke-opacity="0.76" stroke-width="3"/>
      ${shots
        .map((shot, index) => {
          const visible = smooth(0.24 + index * 0.065, 0.42 + index * 0.065, progress)
          const y = mix(296, 278, visible)
          const selected = index === 2 && review > 0
          return `<g opacity="${n(visible)}" transform="translate(0 ${n(mix(15, 0, visible))})" filter="url(#small-shadow)">
          ${roundedRect(shot.x, y, 146, 228, { fill: "#111f34", radius: 17, stroke: selected ? accent : shot.color, strokeOpacity: selected ? 0.9 : 0.34, strokeWidth: selected ? 2 : 1 })}
          <rect x="${shot.x + 9}" y="${n(y + 9)}" width="128" height="112" rx="11" fill="${shot.color}" fill-opacity="0.12"/>
          ${shotArtwork(index, shot.x + 9, y + 9, shot.color)}
          ${text(shot.label, shot.x + 15, y + 151, { fill: shot.color, size: 10, tracking: 0.7, weight: 720 })}
          ${text(shot.note, shot.x + 15, y + 178, { size: 14, weight: 650 })}
          ${text(index === 4 ? "track out · 4s" : `${[24, 50, 85, 35][index] ?? 50}mm · ${index + 2}s`, shot.x + 15, y + 201, { fill: "#7f8ea5", size: 10 })}
          ${index < shots.length - 1 ? `<path d="M${shot.x + 148} 413 h14 l-5 -5 m5 5 l-5 5" fill="none" stroke="${shot.color}" stroke-opacity="${n(connectionProgress)}" stroke-width="2"/>` : ""}
        </g>`
        })
        .join("")}
      <g opacity="${n(review)}">
        ${roundedRect(386, 532, 796, 42, { fill: accent, opacity: 0.08, radius: 13, stroke: accent, strokeOpacity: 0.28 })}
        ${checkMark(407, 555, accent)}
        ${text("Ordered and connected", 427, 559, { fill: accent, size: 12, weight: 680 })}
        ${text("Continuity risk: eyeline after Shot 03", 1156, 559, { anchor: "end", fill: "#c5cfdd", size: 12 })}
      </g>
    </g>
  `,
    {
      accent,
      footer: ["SCRIPT", "SHOT CARDS", "ARRANGE", "REVIEW"],
      label: "CANVAS WORKFLOW",
      subtitle: "Turn a creative brief into connected, reviewable shot cards.",
      title: "Storyboard Builder",
    },
    progress,
  )
}

const showcases = [
  { id: "canvas-storyboard", posterProgress: 0.88, render: canvasStoryboard },
]

function renderShowcase(showcase) {
  const destination = join(outputRoot, showcase.id)
  mkdirSync(destination, { recursive: true })
  const working = mkdtempSync(join(tmpdir(), `convax-builtin-${showcase.id}-`))
  try {
    const svgDirectory = join(working, "svg")
    const pngDirectory = join(working, "png")
    mkdirSync(svgDirectory)
    mkdirSync(pngDirectory)
    const frames = []
    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / (frameCount - 1)
      const frame = join(svgDirectory, `${String(index).padStart(4, "0")}.svg`)
      writeFileSync(frame, showcase.render(progress))
      frames.push(frame)
    }
    rasterizeSvgFrames(frames, pngDirectory)
    const posterIndex = Math.round(showcase.posterProgress * (frameCount - 1))
    copyFileSync(join(pngDirectory, `${String(posterIndex).padStart(4, "0")}.png`), join(destination, "poster.png"))
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      String(fps),
      "-i",
      join(pngDirectory, "%04d.png"),
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      join(destination, "animation.mp4"),
    ])
  } finally {
    rmSync(working, { force: true, recursive: true })
  }
}

for (const showcase of showcases) {
  renderShowcase(showcase)
  process.stdout.write(`Rendered ${showcase.id} → ${dirname(join(outputRoot, showcase.id, "poster.png"))}\n`)
}

const preservedFilenameTailGraphemes = 6
const minimumFilenameLeadingGraphemes = 4
const filenameGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function fitProjectFilename(
  name: string,
  availableWidth: number,
  measureText: (value: string) => number,
) {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || measureText(name) <= availableWidth) return name

  const extensionIndex = name.lastIndexOf(".")
  const hasExtension = extensionIndex > 0 && extensionIndex < name.length - 1
  const stem = hasExtension ? name.slice(0, extensionIndex) : name
  const extension = hasExtension ? name.slice(extensionIndex) : ""
  const graphemes = [...filenameGraphemeSegmenter.segment(stem)].map((part) => part.segment)
  if (graphemes.length < 2) return name

  const maximumTailLength = Math.min(preservedFilenameTailGraphemes, graphemes.length - 1)
  for (let tailLength = maximumTailLength; tailLength >= 1; tailLength -= 1) {
    const maximumLeadingLength = graphemes.length - tailLength
    const minimumLeadingLength = Math.min(minimumFilenameLeadingGraphemes, maximumLeadingLength)
    const trailing = `${graphemes.slice(-tailLength).join("")}${extension}`
    const candidate = (leadingLength: number) => `${graphemes.slice(0, leadingLength).join("")}…${trailing}`
    if (measureText(candidate(minimumLeadingLength)) > availableWidth) continue

    let low = minimumLeadingLength
    let high = maximumLeadingLength
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (measureText(candidate(middle)) <= availableWidth) low = middle
      else high = middle - 1
    }
    return candidate(low)
  }

  return name
}

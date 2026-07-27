import { cn } from "@convax/ui"

export interface ConvaxBrandProps {
  className?: string
  label?: string
  showWordmark?: boolean
  tone?: "brand" | "monochrome"
}

const radialCSpokes = [
  [89.6, 47.1, 76.4, 8.2, 1.9],
  [85, 49, 63.4, 13.7, 1.79],
  [80.6, 51.4, 52.2, 21.7, 1.95],
  [76.9, 54.1, 42.3, 30.5, 1.96],
  [73.8, 57.6, 34.7, 40.8, 1.88],
  [70.9, 61.3, 28.1, 51.7, 1.75],
  [68, 65.6, 24, 63.1, 1.75],
  [66, 70.3, 21.9, 74.8, 1.92],
  [65.1, 75.3, 21, 87.2, 2.02],
  [64.2, 80.4, 22.7, 99.3, 2.02],
  [64.3, 85.4, 26.5, 111.3, 2.05],
  [64.9, 90.9, 32.2, 123.2, 2.2],
  [66.9, 95.9, 40, 135.3, 2.49],
  [69, 102, 50.5, 145.8, 2.4],
  [72.7, 106.9, 62, 155, 2.44],
  [77.1, 112, 75.5, 163, 2.51],
  [82.3, 114.9, 91.5, 169.1, 3.42],
  [89.4, 118.9, 108.3, 171.9, 3.82],
  [97.3, 120.8, 125.4, 172.3, 3.95],
  [105.2, 120.9, 142.2, 168.9, 4.09],
  [112.7, 119.3, 158, 162, 4.51],
  [120.1, 115.9, 172, 151.5, 4.62],
  [125.9, 110.2, 179.8, 136.3, 4.64],
  [130, 102.9, 176.3, 117.2, 4.67],
  [130.1, 61.2, 175.5, 42.2, 4.39],
  [125.4, 54.5, 170.7, 24, 4.26],
  [118.9, 49.9, 156, 12, 3.6],
  [112.9, 46.9, 138.7, 4.2, 3.13],
  [107.7, 41.9, 121.2, 1.1, 2.63],
  [100.5, 44, 105.1, 1, 1.97],
  [94.8, 46, 89.8, 3.9, 2.03],
] as const

function taperedSpokePath([innerX, innerY, outerX, outerY, width]: (typeof radialCSpokes)[number]) {
  const deltaX = outerX - innerX
  const deltaY = outerY - innerY
  const length = Math.hypot(deltaX, deltaY)
  const unitX = deltaX / length
  const unitY = deltaY / length
  const perpendicularX = -unitY
  const perpendicularY = unitX
  const innerWidth = width * 0.55
  const outerWidth = width * 1.45
  const innerCenterX = innerX + unitX * innerWidth * 0.5
  const innerCenterY = innerY + unitY * innerWidth * 0.5
  const outerCenterX = outerX - unitX * outerWidth * 0.5
  const outerCenterY = outerY - unitY * outerWidth * 0.5
  const round = (value: number) => Number(value.toFixed(2))
  const innerLeft = [
    round(innerCenterX + perpendicularX * innerWidth * 0.5),
    round(innerCenterY + perpendicularY * innerWidth * 0.5),
  ]
  const outerLeft = [
    round(outerCenterX + perpendicularX * outerWidth * 0.5),
    round(outerCenterY + perpendicularY * outerWidth * 0.5),
  ]
  const outerRight = [
    round(outerCenterX - perpendicularX * outerWidth * 0.5),
    round(outerCenterY - perpendicularY * outerWidth * 0.5),
  ]
  const innerRight = [
    round(innerCenterX - perpendicularX * innerWidth * 0.5),
    round(innerCenterY - perpendicularY * innerWidth * 0.5),
  ]

  return [
    `M${innerLeft.join(" ")}`,
    `L${outerLeft.join(" ")}`,
    `A${round(outerWidth * 0.5)} ${round(outerWidth * 0.5)} 0 0 0 ${outerRight.join(" ")}`,
    `L${innerRight.join(" ")}`,
    `A${round(innerWidth * 0.5)} ${round(innerWidth * 0.5)} 0 0 0 ${innerLeft.join(" ")}`,
    "Z",
  ].join("")
}

/**
 * Product-owned rendering of the approved Convax radial-C mark.
 *
 * The 31 spoke axes and widths are traced from the supplied master image. Their tapered
 * round-ended profile, uneven inner radius, progressive weight, and open right edge are
 * intentional.
 */
export function ConvaxBrand({
  className,
  label = "Convax",
  showWordmark = false,
  tone = "brand",
}: ConvaxBrandProps) {
  const branded = tone === "brand"

  return (
    <span
      aria-label={label}
      className={cn("inline-flex min-w-0 items-center gap-2 text-text-primary", className)}
      data-convax-brand
      role="img"
    >
      <svg aria-hidden="true" className="size-[22px] shrink-0" fill="none" viewBox="0 0 100 100">
        {branded ? (
          <rect
            fill="#080808"
            height="84"
            rx="15"
            stroke="rgb(255 255 255 / 12%)"
            strokeWidth=".6"
            width="84"
            x="8"
            y="8"
          />
        ) : null}
        <g
          data-logo-part="radial-c"
          data-spoke-count={radialCSpokes.length}
          fill={branded ? "#f7f7f5" : "currentColor"}
          transform="translate(24 27.64) scale(.26)"
        >
          {radialCSpokes.map((spoke, index) => (
            <path d={taperedSpokePath(spoke)} key={index} />
          ))}
        </g>
      </svg>
      {showWordmark ? (
        <span className="truncate text-[13px] font-semibold tracking-[-0.012em]">
          conva
          <span className={branded ? "text-brand" : undefined}>x</span>
        </span>
      ) : null}
    </span>
  )
}

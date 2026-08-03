export type DesktopTestShard = Readonly<{
  index: number
  total: number
}>

const maximumShardCount = 16

export function parseDesktopTestShard(value: string | undefined): DesktopTestShard {
  if (value === undefined || value === "") return { index: 1, total: 1 }

  const match = /^(\d+)\/(\d+)$/.exec(value)
  const index = Number(match?.[1])
  const total = Number(match?.[2])
  if (
    match === null ||
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(total) ||
    index < 1 ||
    total < 1 ||
    index > total ||
    total > maximumShardCount
  ) {
    throw new Error(`CONVAX_DESKTOP_TEST_SHARD must be INDEX/TOTAL with 1 <= INDEX <= TOTAL <= ${maximumShardCount}`)
  }

  return { index, total }
}

export function selectDesktopTestShard<T>(files: readonly T[], shard: DesktopTestShard): T[] {
  return files.filter((_, fileIndex) => fileIndex % shard.total === shard.index - 1)
}

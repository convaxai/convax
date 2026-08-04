export type ProjectFileId = `pf_${string}`
export type ProjectDirectoryId = `pd_${string}`
export type ProjectEntryId = ProjectFileId | ProjectDirectoryId
export type ProjectVersionId = `pv_${string}`

const projectFileIdPattern = /^pf_[0-9a-f]{64}$/
const projectDirectoryIdPattern = /^pd_[0-9a-f]{64}$/
const projectVersionIdPattern = /^pv_[0-9a-f]{64}$/

export class InvalidProjectIdentityError extends Error {
  constructor(
    readonly kind: "directory" | "entry" | "file" | "version",
    readonly value: unknown,
  ) {
    super(`Invalid Project ${kind} identity`)
    this.name = "InvalidProjectIdentityError"
  }
}

export function isProjectFileId(value: unknown): value is ProjectFileId {
  return typeof value === "string" && projectFileIdPattern.test(value)
}

export function isProjectDirectoryId(value: unknown): value is ProjectDirectoryId {
  return typeof value === "string" && projectDirectoryIdPattern.test(value)
}

export function isProjectEntryId(value: unknown): value is ProjectEntryId {
  return isProjectFileId(value) || isProjectDirectoryId(value)
}

export function isProjectVersionId(value: unknown): value is ProjectVersionId {
  return typeof value === "string" && projectVersionIdPattern.test(value)
}

export function parseProjectFileId(value: unknown): ProjectFileId {
  if (!isProjectFileId(value)) throw new InvalidProjectIdentityError("file", value)
  return value
}

export function parseProjectDirectoryId(value: unknown): ProjectDirectoryId {
  if (!isProjectDirectoryId(value)) throw new InvalidProjectIdentityError("directory", value)
  return value
}

export function parseProjectEntryId(value: unknown): ProjectEntryId {
  if (!isProjectEntryId(value)) throw new InvalidProjectIdentityError("entry", value)
  return value
}

export function parseProjectVersionId(value: unknown): ProjectVersionId {
  if (!isProjectVersionId(value)) throw new InvalidProjectIdentityError("version", value)
  return value
}

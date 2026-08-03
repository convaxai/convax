export function isCanvasTextInlineEditingScopeActive(input: {
  editableResource: boolean
  ownsSingleNodeContext: boolean
  readOnly: boolean
}) {
  return input.ownsSingleNodeContext && !input.readOnly && input.editableResource
}

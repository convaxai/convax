import type { AgentResource } from "@convax/agent-runtime"
import {
  agentComposerTokenClassName,
  agentComposerTokenEditClassName,
  agentComposerTokenFamilyClassName,
  agentComposerTokenPresentation,
  agentComposerTokenRemoveClassName,
} from "./agent-composer-dom"

export function AgentComposerResourceToken(props: {
  disabled?: boolean
  onRemove(): void
  resource: AgentResource
  warning?: boolean
}) {
  const presentation = agentComposerTokenPresentation(props.resource)
  const familyClassName = props.warning
    ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : agentComposerTokenFamilyClassName(presentation.family)
  return (
    <span
      className={`${agentComposerTokenClassName} ${familyClassName}`}
      data-agent-composer-token=""
      title={presentation.title}
    >
      <span className={agentComposerTokenEditClassName}>
        <span aria-hidden="true" className="shrink-0">
          {presentation.prefix}
        </span>
        <span className="truncate">{presentation.label}</span>
      </span>
      <button
        aria-label={presentation.removeLabel}
        className={agentComposerTokenRemoveClassName}
        disabled={props.disabled}
        onClick={props.onRemove}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
    </span>
  )
}

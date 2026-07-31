/**
 * Signals that a capability owner could not prove publication rollback.
 * Coordinators must retain their recovery envelope instead of inferring either
 * the previous or next durable state.
 */
export class CapabilityPublicationRecoveryRequiredError extends AggregateError {
  readonly recoveryRequired = true

  constructor(errors: Iterable<unknown>, message: string, options?: ErrorOptions) {
    super(errors, message, options)
    this.name = "CapabilityPublicationRecoveryRequiredError"
  }
}

export function isCapabilityPublicationRecoveryRequiredError(
  error: unknown,
): error is CapabilityPublicationRecoveryRequiredError {
  return error instanceof CapabilityPublicationRecoveryRequiredError
}

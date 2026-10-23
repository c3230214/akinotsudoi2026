/**
 * Business-rule failure. `status` is a hint for the HTTP layer only; the domain
 * itself never touches HTTP.
 */
export class DomainError extends Error {
  constructor(code, message, { status = 409, details } = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export function fail(code, message, options) {
  throw new DomainError(code, message, options);
}

export function invalid(message, details) {
  throw new DomainError('VALIDATION_FAILED', message, { status: 422, details });
}

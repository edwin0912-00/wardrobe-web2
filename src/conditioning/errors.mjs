export class ConditioningError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ConditioningError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new ConditioningError(code, message, details);
}

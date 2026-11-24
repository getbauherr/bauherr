export class RunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class RunNotFound extends RunError {}
export class RunNotClaimed extends RunError {}
export class WrongLeaseToken extends RunError {}
export class LeaseLost extends RunError {}
export class RunConflict extends RunError {}
export class ModuleMissing extends RunError {}
export class SessionNotFound extends RunError {}
export class WrongKeyKind extends RunError {}
export class ProofRefused extends RunError {}
export class UnknownTool extends RunError {}
export class RecordClosed extends RunError {}
export class OptionRefused extends RunError {}

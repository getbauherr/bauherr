export class RunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class RunNotFound extends RunError {}
export class RunNotClaimed extends RunError {}
export class WrongLeaseToken extends RunError {}
export class RunConflict extends RunError {}

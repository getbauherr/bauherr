export class WriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ProductObserving extends WriteError {}
export class TargetNotFound extends WriteError {}
export class WrongItemKind extends WriteError {}
export class HeadMoved extends WriteError {}
export class LabelOutsideNamespace extends WriteError {}

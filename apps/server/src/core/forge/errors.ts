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

export const assertActive = (row: { productState: string; productName: string }): void => {
  if (row.productState !== 'active') {
    throw new ProductObserving(`Product ${row.productName} is observing: nothing is written to the forge.`)
  }
}

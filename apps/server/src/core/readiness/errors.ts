export class ReadinessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
export class ReadinessInvalid extends ReadinessError {}
export class NotAllowedToChangeReadiness extends ReadinessError {}

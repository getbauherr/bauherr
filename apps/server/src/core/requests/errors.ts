export class RequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
export class RequestInvalid extends RequestError {}
export class QuestionsRefused extends RequestError {}

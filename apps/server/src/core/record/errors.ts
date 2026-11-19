export class RecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class RecordNotFound extends RecordError {}
export class CorruptRecord extends RecordError {}
export class VersionConflict extends RecordError {}
export class FieldNotWritable extends RecordError {}
export class InvalidPatch extends RecordError {}
export class StatusChangeNotAllowed extends RecordError {}
export class ProofRequired extends RecordError {}
export class CriteriaEditNotAllowed extends RecordError {}

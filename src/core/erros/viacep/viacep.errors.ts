export class ViacepError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

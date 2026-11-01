export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Works the same on Express 4 and 5.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

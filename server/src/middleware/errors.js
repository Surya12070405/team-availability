import { ZodError } from 'zod';
import mongoose from 'mongoose';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (req, _res, next) =>
  next(new HttpError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`));

/** Wrap async route handlers so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return next(parsed.error);
    req.valid = { ...(req.valid || {}), [source]: parsed.data };
    next();
  };
}

/** 24-hex-char ids only (mongoose.isValidObjectId also accepts any 12-character string). */
export const validateObjectId = (...names) => (req, _res, next) => {
  for (const name of names) {
    if (!/^[a-f0-9]{24}$/i.test(req.params[name] || '')) {
      return next(new HttpError(400, 'INVALID_ID', `${name} is not valid`));
    }
  }
  next();
};

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some of the information provided is not valid',
        details: err.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
      },
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  if (err instanceof HttpError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That already exists' } });
  }
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Some of the information provided is not valid' } });
  }
  console.error('Unexpected error:', err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' } });
}

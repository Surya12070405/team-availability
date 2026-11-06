import { z } from 'zod';
import { DateTime } from 'luxon';
import { isValidTimezone } from './slots.js';
import { MAX_DAYS, MAX_MEETING_MINUTES } from './limits.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoSlot = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'Must be a UTC time like 2026-11-04T09:30:00Z');

const timezone = z
  .string({ required_error: 'Timezone is required' })
  .refine(isValidTimezone, 'Timezone must be a valid IANA name such as Europe/London');

const label = (field, max) =>
  z
    .string({ required_error: `${field} is required` })
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(1, `${field} is required`)
        .max(max, `${field} can be at most ${max} characters`)
        .regex(/^[^\u0000-\u001f<>]+$/, `${field} contains characters that are not allowed`),
    );

const startDate = z
  .string({ required_error: 'Start date is required' })
  .regex(DATE_RE, 'Start date must be in YYYY-MM-DD format')
  .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid, 'Start date is not a real date')
  .refine((s) => {
    const d = DateTime.fromISO(s, { zone: 'utc' });
    const today = DateTime.utc().startOf('day');
    return d >= today.minus({ days: 1 }) && d <= today.plus({ days: 365 });
  }, 'Start date must be within the next year and not in the past');

export const createBoardSchema = z
  .object({
    title: label('Title', 80),
    timezone,
    startDate,
    days: z.number({ required_error: 'Number of days is required', invalid_type_error: 'Days must be a number' })
      .int('Days must be a whole number').min(1, 'Choose at least 1 day').max(MAX_DAYS, `Choose at most ${MAX_DAYS} days`),
    dayStartHour: z.number({ required_error: 'Day start is required', invalid_type_error: 'Day start must be a number' })
      .int().min(0, 'Day start must be between 0 and 23').max(23, 'Day start must be between 0 and 23'),
    dayEndHour: z.number({ required_error: 'Day end is required', invalid_type_error: 'Day end must be a number' })
      .int().min(1, 'Day end must be between 1 and 24').max(24, 'Day end must be between 1 and 24'),
    slotMinutes: z.union([z.literal(30), z.literal(60)], { errorMap: () => ({ message: 'Slot length must be 30 or 60 minutes' }) }),
  })
  .strict('Unknown field in request body')
  .refine((b) => b.dayEndHour > b.dayStartHour, { message: 'Day end must be after day start', path: ['dayEndHour'] });

export const joinSchema = z.object({ name: label('Name', 40), timezone }).strict('Unknown field in request body');

export const availabilitySchema = z
  .object({ slots: z.array(isoSlot, { required_error: 'slots is required', invalid_type_error: 'slots must be a list' }).max(1000, 'Too many slots') })
  .strict('Unknown field in request body');

export const optionSchema = z
  .object({
    start: isoSlot,
    durationMinutes: z.number({ required_error: 'Duration is required', invalid_type_error: 'Duration must be a number' })
      .int('Duration must be a whole number').min(30, 'Duration must be at least 30 minutes')
      .max(MAX_MEETING_MINUTES, `Duration can be at most ${MAX_MEETING_MINUTES} minutes`),
  })
  .strict('Unknown field in request body');

export const voteSchema = z
  .object({ vote: z.boolean({ required_error: 'vote is required', invalid_type_error: 'vote must be true or false' }) })
  .strict('Unknown field in request body');

export const meetingSchema = z
  .object({ optionId: z.string({ required_error: 'optionId is required' }).regex(/^[a-f0-9]{24}$/i, 'optionId is not valid') })
  .strict('Unknown field in request body');

export const suggestionsQuerySchema = z.object({
  duration: z.coerce.number({ invalid_type_error: 'duration must be a number' }).int().min(30, 'duration must be at least 30 minutes')
    .max(MAX_MEETING_MINUTES, `duration can be at most ${MAX_MEETING_MINUTES} minutes`).default(60),
  limit: z.coerce.number().int().min(1, 'limit must be at least 1').max(20, 'limit can be at most 20').default(5),
});

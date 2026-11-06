import { Router } from 'express';
import { Member, Option, isDuplicateKey } from '../models/index.js';
import { optionSchema, voteSchema } from '../lib/validation.js';
import { MAX_OPTIONS } from '../lib/limits.js';
import { locateWindow, prepare } from '../lib/suggest.js';
import { asyncHandler, HttpError, validate, validateObjectId } from '../middleware/errors.js';
import { hashToken, isAdmin, requireMember } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

const notFinalised = (req, _res, next) =>
  req.board.meeting ? next(new HttpError(409, 'MEETING_FINALIZED', 'The meeting has been finalised. Ask the organiser to reopen the poll.')) : next();

// POST /api/boards/:slug/options - propose a meeting time (the proposer automatically votes for it)
router.post(
  '/',
  validate(optionSchema),
  requireMember,
  notFinalised,
  asyncHandler(async (req, res) => {
    const { board, member } = req;
    const { start, durationMinutes } = req.valid.body;

    const prep = prepare({ slots: board.slots, slotMinutes: board.slotMinutes, members: [] });
    if (!locateWindow(prep, start, durationMinutes)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Some of the information provided is not valid', [
        { field: 'start', message: `That time is not available on this board. Meetings must start on a ${board.slotMinutes}-minute slot, last a multiple of ${board.slotMinutes} minutes, and fit inside the board's days and hours.` },
      ]);
    }
    if ((await Option.countDocuments({ boardId: board._id })) >= MAX_OPTIONS) {
      throw new HttpError(409, 'TOO_MANY_OPTIONS', `A poll can have at most ${MAX_OPTIONS} options`);
    }
    try {
      const o = await Option.create({ boardId: board._id, start, durationMinutes, proposedBy: member._id, votes: [member._id] });
      res.status(201).json({
        option: { id: String(o._id), start, durationMinutes, proposedBy: String(member._id), votes: [String(member._id)] },
      });
    } catch (err) {
      if (isDuplicateKey(err)) throw new HttpError(409, 'DUPLICATE_OPTION', 'That time is already in the poll. Vote for it instead.');
      throw err;
    }
  }),
);

// PUT /api/boards/:slug/options/:optionId/vote  { vote: true|false }
router.put(
  '/:optionId/vote',
  validateObjectId('optionId'),
  validate(voteSchema),
  requireMember,
  notFinalised,
  asyncHandler(async (req, res) => {
    const update = req.valid.body.vote ? { $addToSet: { votes: req.member._id } } : { $pull: { votes: req.member._id } };
    const option = await Option.findOneAndUpdate({ _id: req.params.optionId, boardId: req.board._id }, update, { new: true });
    if (!option) throw new HttpError(404, 'OPTION_NOT_FOUND', 'That poll option no longer exists');
    res.json({ votes: option.votes.map(String) });
  }),
);

// DELETE /api/boards/:slug/options/:optionId - proposer or organiser removes an option
router.delete(
  '/:optionId',
  validateObjectId('optionId'),
  notFinalised,
  asyncHandler(async (req, res) => {
    const option = await Option.findOne({ _id: req.params.optionId, boardId: req.board._id });
    if (!option) throw new HttpError(404, 'OPTION_NOT_FOUND', 'That poll option no longer exists');

    if (!isAdmin(req)) {
      const token = req.get('x-member-token');
      if (!token) throw new HttpError(401, 'MEMBER_TOKEN_REQUIRED', 'Join the board first to do this');
      const me = await Member.findOne({ boardId: req.board._id, tokenHash: hashToken(token) });
      if (!me) throw new HttpError(401, 'INVALID_TOKEN', 'Your membership could not be verified. Join the board again.');
      if (String(option.proposedBy) !== String(me._id)) throw new HttpError(403, 'FORBIDDEN', 'Only the person who proposed this time, or the organiser, can remove it');
    }
    await Option.deleteOne({ _id: option._id });
    res.status(204).end();
  }),
);

export default router;

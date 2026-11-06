import { Router } from 'express';
import { Board, Member, Option, isDuplicateKey } from '../models/index.js';
import { createBoardSchema, meetingSchema, suggestionsQuerySchema } from '../lib/validation.js';
import { generateSlots } from '../lib/slots.js';
import { suggestWindows } from '../lib/suggest.js';
import { serializeState } from '../lib/serialize.js';
import { asyncHandler, HttpError, validate } from '../middleware/errors.js';
import { hashToken, loadBoard, newSlug, newToken, requireAdmin } from '../middleware/auth.js';
import membersRouter from './members.js';
import optionsRouter from './options.js';

const router = Router();

// POST /api/boards - create a board; the response includes the one-time organiser key
router.post(
  '/',
  validate(createBoardSchema),
  asyncHandler(async (req, res) => {
    const input = req.valid.body;
    const slots = generateSlots(input);
    const adminToken = newToken();
    let board = null;
    for (let attempt = 0; attempt < 5 && !board; attempt++) {
      try {
        board = await Board.create({ ...input, slug: newSlug(), slots, adminTokenHash: hashToken(adminToken) });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
    if (!board) throw new HttpError(500, 'SLUG_FAILED', 'Could not create the board. Please try again.');
    res.status(201).json({ ...serializeState(board, [], [], req), adminToken });
  }),
);

// GET /api/boards/:slug - full state (board, members + availability, poll options)
router.get(
  '/:slug',
  loadBoard,
  asyncHandler(async (req, res) => {
    const [members, options] = await Promise.all([
      Member.find({ boardId: req.board._id }).sort({ createdAt: 1 }).lean(),
      Option.find({ boardId: req.board._id }).sort({ start: 1 }).lean(),
    ]);
    res.json(serializeState(req.board, members, options, req));
  }),
);

// GET /api/boards/:slug/suggestions?duration=60&limit=5 - windows with the most available people
router.get(
  '/:slug/suggestions',
  loadBoard,
  validate(suggestionsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { duration, limit } = req.valid.query;
    const { board } = req;
    if (duration % board.slotMinutes !== 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Some of the information provided is not valid', [
        { field: 'duration', message: `duration must be a multiple of ${board.slotMinutes} minutes for this board` },
      ]);
    }
    const members = (await Member.find({ boardId: board._id }).sort({ createdAt: 1 }).lean()).map((m) => ({
      id: String(m._id),
      name: m.name,
      timezone: m.timezone,
      availability: m.availability,
    }));
    const suggestions = suggestWindows({ slots: board.slots, slotMinutes: board.slotMinutes, members, durationMinutes: duration, limit });
    res.json({ durationMinutes: duration, totalMembers: members.length, suggestions });
  }),
);

// POST /api/boards/:slug/meeting - organiser finalises one of the poll options
router.post(
  '/:slug/meeting',
  loadBoard,
  requireAdmin,
  validate(meetingSchema),
  asyncHandler(async (req, res) => {
    const option = await Option.findOne({ _id: req.valid.body.optionId, boardId: req.board._id });
    if (!option) throw new HttpError(404, 'OPTION_NOT_FOUND', 'That poll option no longer exists');
    const meeting = { start: option.start, durationMinutes: option.durationMinutes, optionId: option._id, finalizedAt: new Date() };
    await Board.updateOne({ _id: req.board._id }, { $set: { meeting } });
    res.json({ meeting: { ...meeting, optionId: String(option._id) } });
  }),
);

// DELETE /api/boards/:slug/meeting - reopen the poll
router.delete(
  '/:slug/meeting',
  loadBoard,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await Board.updateOne({ _id: req.board._id }, { $unset: { meeting: 1 } });
    res.status(204).end();
  }),
);

// DELETE /api/boards/:slug - organiser deletes the whole board
router.delete(
  '/:slug',
  loadBoard,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const boardId = req.board._id;
    await Promise.all([Member.deleteMany({ boardId }), Option.deleteMany({ boardId })]);
    await Board.deleteOne({ _id: boardId });
    res.status(204).end();
  }),
);

router.use('/:slug/members', loadBoard, membersRouter);
router.use('/:slug/options', loadBoard, optionsRouter);

export default router;

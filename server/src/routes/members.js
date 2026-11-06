import { Router } from 'express';
import { Member, Option, isDuplicateKey } from '../models/index.js';
import { availabilitySchema, joinSchema } from '../lib/validation.js';
import { MAX_MEMBERS } from '../lib/limits.js';
import { asyncHandler, HttpError, validate, validateObjectId } from '../middleware/errors.js';
import { hashToken, isAdmin, newToken } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

// POST /api/boards/:slug/members - join the board; returns a private key to keep in the browser
router.post(
  '/',
  validate(joinSchema),
  asyncHandler(async (req, res) => {
    const { board } = req;
    const { name, timezone } = req.valid.body;
    if ((await Member.countDocuments({ boardId: board._id })) >= MAX_MEMBERS) {
      throw new HttpError(409, 'BOARD_FULL', `This board already has the maximum of ${MAX_MEMBERS} members`);
    }
    const token = newToken();
    try {
      const m = await Member.create({
        boardId: board._id, name, nameKey: name.toLowerCase(), timezone, tokenHash: hashToken(token), availability: [],
      });
      res.status(201).json({ member: { id: String(m._id), name: m.name, timezone: m.timezone, availability: [] }, token });
    } catch (err) {
      if (isDuplicateKey(err)) throw new HttpError(409, 'NAME_TAKEN', 'Someone with that name is already on this board. Use a different name.');
      throw err;
    }
  }),
);

const loadMember = asyncHandler(async (req, _res, next) => {
  const member = await Member.findOne({ _id: req.params.memberId, boardId: req.board._id });
  if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Member not found');
  req.target = member;
  next();
});

const isSelf = (req) => {
  const t = req.get('x-member-token');
  return !!t && hashToken(t) === req.target.tokenHash;
};

// PUT /api/boards/:slug/members/:memberId/availability - replace my availability
router.put(
  '/:memberId/availability',
  validateObjectId('memberId'),
  validate(availabilitySchema),
  loadMember,
  asyncHandler(async (req, res) => {
    if (!req.get('x-member-token')) throw new HttpError(401, 'MEMBER_TOKEN_REQUIRED', 'Join the board first to do this');
    if (!isSelf(req)) throw new HttpError(403, 'FORBIDDEN', 'You can only change your own availability');

    const valid = new Set(req.board.slots);
    const outside = req.valid.body.slots.filter((s) => !valid.has(s));
    if (outside.length) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Some of the information provided is not valid', [
        { field: 'slots', message: `${outside.length} time(s) are outside this board's schedule` },
      ]);
    }
    const availability = [...new Set(req.valid.body.slots)].sort();
    await Member.updateOne({ _id: req.target._id }, { $set: { availability } });
    res.json({ availability });
  }),
);

// DELETE /api/boards/:slug/members/:memberId - leave the board (or organiser removes someone)
router.delete(
  '/:memberId',
  validateObjectId('memberId'),
  loadMember,
  asyncHandler(async (req, res) => {
    if (!req.get('x-member-token') && !req.get('x-admin-token')) {
      throw new HttpError(401, 'MEMBER_TOKEN_REQUIRED', 'Join the board first to do this');
    }
    if (!isSelf(req) && !isAdmin(req)) throw new HttpError(403, 'FORBIDDEN', 'You can only remove yourself, unless you are the organiser');
    await Member.deleteOne({ _id: req.target._id });
    await Option.updateMany({ boardId: req.board._id }, { $pull: { votes: req.target._id } });
    res.status(204).end();
  }),
);

export default router;

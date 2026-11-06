import crypto from 'node:crypto';
import { Board, Member } from '../models/index.js';
import { asyncHandler, HttpError } from './errors.js';

export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const newToken = () => crypto.randomBytes(24).toString('base64url');

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters
export const newSlug = (len = 8) => Array.from({ length: len }, () => SLUG_ALPHABET[crypto.randomInt(SLUG_ALPHABET.length)]).join('');

const safeEqual = (a, b) => {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

export const SLUG_RE = /^[a-z0-9-]{3,32}$/;

export const loadBoard = asyncHandler(async (req, _res, next) => {
  const slug = req.params.slug;
  const board = SLUG_RE.test(slug) ? await Board.findOne({ slug }) : null;
  if (!board) throw new HttpError(404, 'BOARD_NOT_FOUND', 'Board not found. Check the link and try again.');
  req.board = board;
  next();
});

export const isAdmin = (req) => {
  const t = req.get('x-admin-token');
  return !!t && safeEqual(hashToken(t), req.board.adminTokenHash);
};

export const requireAdmin = (req, _res, next) => {
  if (!req.get('x-admin-token')) return next(new HttpError(401, 'ADMIN_TOKEN_REQUIRED', 'Only the organiser can do this'));
  if (!isAdmin(req)) return next(new HttpError(403, 'FORBIDDEN', 'That organiser key is not valid for this board'));
  next();
};

/** Identifies the board member from the X-Member-Token header. */
export const requireMember = asyncHandler(async (req, _res, next) => {
  const token = req.get('x-member-token');
  if (!token) throw new HttpError(401, 'MEMBER_TOKEN_REQUIRED', 'Join the board first to do this');
  const member = await Member.findOne({ boardId: req.board._id, tokenHash: hashToken(token) });
  if (!member) throw new HttpError(401, 'INVALID_TOKEN', 'Your membership could not be verified. Join the board again.');
  req.member = member;
  next();
});

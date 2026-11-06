import { availabilityForWindow, prepare } from './suggest.js';
import { MAX_MEMBERS, MAX_OPTIONS } from './limits.js';
import { hashToken } from '../middleware/auth.js';

const id = (v) => String(v);

/** Public view of a board plus everything the UI needs. Never includes token hashes. */
export function serializeState(board, members, options, req = null) {
  const memberViews = members.map((m) => ({
    id: id(m._id),
    name: m.name,
    timezone: m.timezone,
    availability: m.availability || [],
  }));

  const prep = prepare({ slots: board.slots, slotMinutes: board.slotMinutes, members: memberViews });

  const optionViews = options.map((o) => {
    const w = availabilityForWindow(prep, o.start, o.durationMinutes);
    return {
      id: id(o._id),
      start: o.start,
      durationMinutes: o.durationMinutes,
      end: w?.end ?? null,
      proposedBy: o.proposedBy ? id(o.proposedBy) : null,
      votes: (o.votes || []).map(id),
      availableIds: w ? w.available.map((m) => m.id) : [],
      unavailableIds: w ? w.unavailable.map((m) => m.id) : [],
      offHoursIds: w ? w.offHours.map((m) => m.id) : [],
    };
  });

  // Who is asking? Lets the client confirm that its saved keys are still valid.
  let viewer = { memberId: null, isAdmin: false };
  if (req) {
    const mt = req.get('x-member-token');
    if (mt) {
      const h = hashToken(mt);
      const me = members.find((m) => m.tokenHash === h);
      if (me) viewer.memberId = id(me._id);
    }
    const at = req.get('x-admin-token');
    if (at && hashToken(at) === board.adminTokenHash) viewer.isAdmin = true;
  }

  return {
    board: {
      slug: board.slug,
      title: board.title,
      timezone: board.timezone,
      startDate: board.startDate,
      days: board.days,
      dayStartHour: board.dayStartHour,
      dayEndHour: board.dayEndHour,
      slotMinutes: board.slotMinutes,
      slots: board.slots,
      meeting: board.meeting
        ? {
            start: board.meeting.start,
            durationMinutes: board.meeting.durationMinutes,
            optionId: board.meeting.optionId ? id(board.meeting.optionId) : null,
            finalizedAt: board.meeting.finalizedAt,
          }
        : null,
      createdAt: board.createdAt,
    },
    members: memberViews,
    options: optionViews,
    viewer,
    limits: { maxMembers: MAX_MEMBERS, maxOptions: MAX_OPTIONS },
  };
}

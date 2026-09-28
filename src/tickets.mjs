// Vendor tickets the owner logs by hand: when a robot's maker was asked for
// help, and when it first answered. The Vendors tab's open count and its
// median days to first reply are worked out from these, so they only mean
// something while the owner keeps them. Nothing here comes from a vendor: no
// vendor we know of exposes its support queue (Sep 2026 robot API research).
export class TicketError extends Error {}

export const TICKET_STATUSES = ["open", "closed"];
const DAY_MS = 86_400_000;

function whenMs(v, label) {
  if (v === undefined || v === null || v === "") return null;
  const ms = typeof v === "number" ? v : Date.parse(String(v));
  if (!Number.isFinite(ms)) throw new TicketError(`${label} is not a date.`);
  return ms;
}

function text(v, label, max) {
  const s = String(v ?? "").trim();
  if (s.length > max) throw new TicketError(`${label} is longer than ${max} characters.`);
  return s;
}

function statusOf(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (!TICKET_STATUSES.includes(s)) throw new TicketError(`status must be ${TICKET_STATUSES.join(" or ")}.`);
  return s;
}

/** The shape the contract carries (contract.mjs maps rows the same way). */
export function ticketOut(t) {
  return { id: t.id, ref: t.ref, brand: t.brand, robotId: t.robot_id, title: t.title, openedAt: t.opened_at, respondedAt: t.responded_at, status: t.status };
}

/** Log a ticket. `openedAt` defaults to now. A reply before the ticket was
 *  opened, a ticket opened in the future, or a robot not on the account is
 *  refused, and nothing is saved. */
export function addTicket(store, body, nowMs) {
  const title = text(body?.title, "title", 200);
  if (!title) throw new TicketError("Say what the ticket is about.");
  const brand = text(body?.brand, "brand", 60) || null;
  const ref = text(body?.ref, "ref", 40) || null;
  let robotId = null;
  if (body?.robotId !== undefined && body?.robotId !== null && body?.robotId !== "") {
    robotId = Number(body.robotId);
    if (!store.listRobots().some((r) => r.id === robotId)) throw new TicketError(`Robot ${body.robotId} is not on this account.`);
  }
  const openedAt = whenMs(body?.openedAt, "openedAt") ?? nowMs;
  if (openedAt > nowMs + DAY_MS) throw new TicketError("openedAt is in the future.");
  const respondedAt = whenMs(body?.respondedAt, "respondedAt");
  if (respondedAt !== null && respondedAt < openedAt) throw new TicketError("respondedAt is before the ticket was opened.");
  const status = statusOf(body?.status, "open");
  const id = store.insertTicket({ ref, brand, robotId, title, openedAt, respondedAt, status });
  return ticketOut(store.ticket(id));
}

/** Mark the first reply (`respondedAt`, null to clear it) or change the
 *  status. Null for a ticket this account does not have. */
export function updateTicket(store, id, body) {
  const cur = store.ticket(Number(id));
  if (!cur) return null;
  const patch = {};
  if (body?.respondedAt !== undefined) {
    const at = whenMs(body.respondedAt, "respondedAt");
    if (at !== null && at < cur.opened_at) throw new TicketError("respondedAt is before the ticket was opened.");
    patch.respondedAt = at;
  }
  if (body?.status !== undefined) patch.status = statusOf(body.status, cur.status);
  return ticketOut(store.updateTicket(cur.id, patch));
}

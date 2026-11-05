/**
 * HR domain events (CLAUDE.md "Domain events").
 *
 * Published by this module (consumed by other modules through the outbox):
 * - `hr.request.<state>`            every HR request transition; payload { number, type, from }
 * - `hr.request.handoff.finance`    an approved advance waiting for Finance on the same number [FIN §11]
 *
 * Consumed: nothing in phase 1. Events nobody handles are parked as 'unhandled' and replayed when a
 * subscriber registers (review B11b), so the Finance module will receive every hand-off published
 * before it existed. Register HR handlers here when they arrive, never inline in a route.
 */
export function registerHrSubscribers(): void {
  // No HR subscriptions yet.
}

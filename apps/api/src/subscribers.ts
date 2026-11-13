import { registerHrSubscribers } from './modules/hr/events';
import { registerTicketSubscribers } from './modules/tickets';
import { registerCrmSubscribers } from './modules/crm/events';

let registered = false;
/**
 * The one place where every module registers its outbox subscribers (review B11b). Called by the api,
 * jobs and outbox Lambda entry points through `registerModules()`, so a handler never depends on which
 * process happens to run the worker.
 */
export function registerSubscribers(): void {
  if (registered) return;
  registered = true;
  registerHrSubscribers();
  registerTicketSubscribers();
  registerCrmSubscribers();
}

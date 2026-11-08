import { connectDb } from '../db';
import { registerModules } from '../bootstrap';
import { runJobs, type JobCadence } from '../core/jobs/registry';

/** Two schedules (review F3): every 5 minutes with input { cadence: 'frequent' }, 06:00 Riyadh with { cadence: 'daily' }. */
export const handler = async (event: { cadence?: JobCadence } = {}) => {
  await connectDb();
  registerModules();
  return runJobs(new Date(), undefined, event.cadence ?? 'daily');
};

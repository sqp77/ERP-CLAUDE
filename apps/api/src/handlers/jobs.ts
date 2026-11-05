import { connectDb } from '../db';
import { registerModules } from '../bootstrap';
import { runJobs } from '../core/jobs/registry';

export const handler = async () => {
  await connectDb();
  registerModules();
  return runJobs();
};

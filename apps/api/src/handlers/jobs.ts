import { connectDb } from '../db';
import { registerCoreJobs } from '../bootstrap';
import { runJobs } from '../core/jobs/registry';

export const handler = async () => {
  await connectDb();
  registerCoreJobs();
  return runJobs();
};

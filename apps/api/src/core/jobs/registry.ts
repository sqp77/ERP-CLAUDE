import { logger } from '../../logger';

export type Job = (now: Date) => Promise<unknown>;
const jobs = new Map<string, Job>();

/** Scheduled work (CLAUDE.md "Async work"). Modules register jobs; the `jobs` handler runs them. */
export function registerJob(name: string, job: Job): void {
  jobs.set(name, job);
}

export async function runJobs(now = new Date(), only?: string[]): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const [name, job] of jobs) {
    if (only && !only.includes(name)) continue;
    try {
      results[name] = await job(now);
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
      results[name] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return results;
}

export const jobNames = () => [...jobs.keys()];

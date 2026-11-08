import { logger } from '../../logger';

export type Job = (now: Date) => Promise<unknown>;
/**
 * Cadence (go-live review F3): 'frequent' jobs run every 5 minutes (reminders, windows, deactivation,
 * follow-ups); 'daily' jobs run once at 06:00 Asia/Riyadh (birthdays, expiry alerts, overdue digests).
 */
export type JobCadence = 'frequent' | 'daily';
const jobs = new Map<string, { job: Job; cadence: JobCadence }>();

/** Scheduled work (CLAUDE.md "Async work"). Modules register jobs; the `jobs` handler runs them by cadence. */
export function registerJob(name: string, job: Job, cadence: JobCadence = 'daily'): void {
  jobs.set(name, { job, cadence });
}

export async function runJobs(
  now = new Date(),
  only?: string[],
  cadence?: JobCadence,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const [name, { job, cadence: c }] of jobs) {
    if (only && !only.includes(name)) continue;
    if (cadence && c !== cadence) continue;
    try {
      results[name] = await job(now);
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
      results[name] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return results;
}

export const jobNames = (cadence?: JobCadence) =>
  [...jobs.entries()].filter(([, j]) => !cadence || j.cadence === cadence).map(([n]) => n);

/** Local development scheduler mirroring the deployed schedule: frequent every 5 minutes, daily at 06:00 Riyadh. */
export function startLocalScheduler(
  opts: { frequentMs?: number; dailyHourRiyadh?: number } = {},
): () => void {
  const frequentMs = opts.frequentMs ?? 5 * 60_000;
  const dailyHour = opts.dailyHourRiyadh ?? 6;
  let lastDaily = '';
  const tick = async () => {
    const now = new Date();
    await runJobs(now, undefined, 'frequent').catch((err) => logger.error({ err }, 'frequent jobs failed'));
    const riyadh = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      hour: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const pick = (t: string) => riyadh.find((p) => p.type === t)?.value ?? '';
    const day = `${pick('year')}-${pick('month')}-${pick('day')}`;
    if (Number(pick('hour')) >= dailyHour && lastDaily !== day) {
      lastDaily = day;
      await runJobs(now, undefined, 'daily').catch((err) => logger.error({ err }, 'daily jobs failed'));
    }
  };
  const h = setInterval(() => void tick(), frequentMs);
  h.unref();
  void tick();
  return () => clearInterval(h);
}

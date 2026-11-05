import { connectDb } from '../db';
import { registerModules } from '../bootstrap';
import { processOutbox } from '../core/outbox/service';

export const handler = async () => {
  await connectDb();
  registerModules();
  return processOutbox(200);
};

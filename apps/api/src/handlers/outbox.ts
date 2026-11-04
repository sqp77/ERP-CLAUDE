import { connectDb } from '../db';
import { processOutbox } from '../core/outbox/service';

export const handler = async () => {
  await connectDb();
  return processOutbox(200);
};

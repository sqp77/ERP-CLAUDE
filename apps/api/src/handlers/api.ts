import serverless from 'serverless-http';
import { connectDb } from '../db';
import { createApp } from '../app';
import { ensureBaselineOnce } from '../bootstrap';

const app = createApp();
const wrapped = serverless(app, {
  binary: [
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'image/*',
  ],
});
export const handler = async (event: unknown, context: { callbackWaitsForEmptyEventLoop?: boolean }) => {
  context.callbackWaitsForEmptyEventLoop = false;
  await connectDb();
  await ensureBaselineOnce();
  return wrapped(event as Parameters<typeof wrapped>[0], context as Parameters<typeof wrapped>[1]);
};

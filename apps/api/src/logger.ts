import pino from 'pino';
import { env } from './config';

export const logger = pino({
  level: env().LOG_LEVEL,
  ...(env().NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.totpSecret'],
});

import { env } from '../../config';
import { logger } from '../../logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Email channel adapter. Off by default (DECISIONS §9) until the sending domain is verified. */
export interface EmailAdapter {
  send(msg: EmailMessage): Promise<void>;
}

export class LogEmailAdapter implements EmailAdapter {
  sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
    logger.info({ to: msg.to, subject: msg.subject }, 'email (log adapter)');
  }
}

export class SesEmailAdapter implements EmailAdapter {
  async send(msg: EmailMessage): Promise<void> {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    const client = new SESClient({ region: env().AWS_REGION });
    await client.send(
      new SendEmailCommand({
        Source: env().EMAIL_FROM,
        Destination: { ToAddresses: [msg.to] },
        Message: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: msg.text, Charset: 'UTF-8' },
            ...(msg.html ? { Html: { Data: msg.html, Charset: 'UTF-8' } } : {}),
          },
        },
      }),
    );
  }
}

let emailAdapter: EmailAdapter | undefined;
export function email(): EmailAdapter {
  if (!emailAdapter)
    emailAdapter = env().NODE_ENV === 'production' ? new SesEmailAdapter() : new LogEmailAdapter();
  return emailAdapter;
}
export function setEmailAdapter(a: EmailAdapter | undefined): void {
  emailAdapter = a;
}

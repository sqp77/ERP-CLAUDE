import { authenticator } from 'otplib';
import QRCode from 'qrcode';

authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(email: string, secret: string, issuer = 'Eayni ERP'): string {
  return authenticator.keyuri(email, issuer, secret);
}

export async function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}

/** Current code — used only by tests. */
export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}

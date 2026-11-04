import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config';
import { hmac } from '../auth/crypto';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * Storage adapter. Files go browser → storage directly (CLAUDE.md "Serverless rules").
 * `s3` presigns real S3 URLs; `local` presigns URLs on this API that write to disk (development only).
 */
export interface StorageAdapter {
  createUploadUrl(key: string, mimeType: string, size: number): Promise<UploadTarget>;
  createDownloadUrl(
    key: string,
    fileName: string,
    mimeType: string,
  ): Promise<{ url: string; expiresAt: string }>;
  delete(key: string): Promise<void>;
  /** Server-side write (generated documents such as certificates). */
  putObject(key: string, body: Buffer, mimeType: string): Promise<void>;
}

const TTL_MS = 15 * 60_000;

export function signLocal(purpose: 'put' | 'get', key: string, expiresAt: number, extra = ''): string {
  return hmac(`${purpose}|${key}|${expiresAt}|${extra}`);
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly root: string;
  constructor(root = env().LOCAL_STORAGE_DIR) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }
  pathFor(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('invalid key');
    return p;
  }
  async createUploadUrl(key: string, mimeType: string, size: number): Promise<UploadTarget> {
    const expiresAt = Date.now() + TTL_MS;
    const sig = signLocal('put', key, expiresAt, `${mimeType}|${size}`);
    const url = `${env().API_URL}/api/v1/files/local/${encodeURIComponent(key)}?exp=${expiresAt}&sig=${sig}&size=${size}&mime=${encodeURIComponent(mimeType)}`;
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  async createDownloadUrl(key: string, fileName: string): Promise<{ url: string; expiresAt: string }> {
    const expiresAt = Date.now() + TTL_MS;
    const sig = signLocal('get', key, expiresAt);
    const url = `${env().API_URL}/api/v1/files/local/${encodeURIComponent(key)}?exp=${expiresAt}&sig=${sig}&name=${encodeURIComponent(fileName)}`;
    return { url, expiresAt: new Date(expiresAt).toISOString() };
  }
  async write(key: string, body: Readable): Promise<number> {
    const p = this.pathFor(key);
    mkdirSync(dirname(p), { recursive: true });
    await pipeline(body, createWriteStream(p));
    return statSync(p).size;
  }
  read(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }
  exists(key: string): boolean {
    return existsSync(this.pathFor(key));
  }
  async delete(key: string): Promise<void> {
    const p = this.pathFor(key);
    if (existsSync(p)) unlinkSync(p);
  }
  async putObject(key: string, body: Buffer): Promise<void> {
    const p = this.pathFor(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}

export class S3StorageAdapter implements StorageAdapter {
  private client?: S3Client;
  private async s3() {
    if (!this.client) {
      const mod = await import('@aws-sdk/client-s3');
      this.client = new mod.S3Client({ region: env().AWS_REGION });
    }
    return this.client;
  }
  async createUploadUrl(key: string, mimeType: string, size: number): Promise<UploadTarget> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(
      await this.s3(),
      new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: mimeType, ContentLength: size }),
      { expiresIn: TTL_MS / 1000 },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    };
  }
  async createDownloadUrl(key: string, fileName: string, mimeType: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(
      await this.s3(),
      new GetObjectCommand({
        Bucket: env().S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        ResponseContentType: mimeType,
      }),
      { expiresIn: TTL_MS / 1000 },
    );
    return { url, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
  }
  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.s3()).send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  }
  async putObject(key: string, body: Buffer, mimeType: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (
      await this.s3()
    ).send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: mimeType }));
  }
}

let adapter: StorageAdapter | undefined;
export function storage(): StorageAdapter {
  if (!adapter) adapter = env().FILE_STORAGE === 's3' ? new S3StorageAdapter() : new LocalStorageAdapter();
  return adapter;
}
export function localStorageAdapter(): LocalStorageAdapter | undefined {
  const s = storage();
  return s instanceof LocalStorageAdapter ? s : undefined;
}

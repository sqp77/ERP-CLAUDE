import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Loader2 } from 'lucide-react';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@eayni/shared';
import { get, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { openSignedUrl } from '@/lib/download';
import i18n from '@/i18n';
import { cx } from '@/shared/ui';

interface Props {
  ownerType?: string;
  ownerId?: string;
  sensitive?: boolean;
  onUploaded: (att: { attachmentId: string; fileName: string }) => void;
  label?: string;
  className?: string;
}

/** Browser → storage directly through a presigned URL, then confirm (CLAUDE.md "Files"). */
export async function uploadFile(
  file: File,
  opts: { ownerType?: string; ownerId?: string; sensitive?: boolean } = {},
): Promise<{ attachmentId: string; fileName: string }> {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type))
    throw new Error(i18n.t('files.typeNotAllowed'));
  if (file.size > MAX_FILE_BYTES)
    throw new Error(i18n.t('files.tooLarge', { mb: MAX_FILE_BYTES / 1024 / 1024 }));
  const pre = await post<{
    attachmentId: string;
    upload: { url: string; method: string; headers: Record<string, string> };
  }>('/files/presign', {
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    ...opts,
  });
  // The presigned URL carries its own authorization; cookies must not be sent to the bucket (review C15).
  const put = await fetch(pre.upload.url, {
    method: pre.upload.method,
    headers: pre.upload.headers,
    body: file,
    credentials: 'omit',
  });
  if (!put.ok) throw new Error(i18n.t('files.uploadFailed'));
  await post(`/files/${pre.attachmentId}/complete`);
  return { attachmentId: pre.attachmentId, fileName: file.name };
}

export function FileUploader({ onUploaded, label, className, ...opts }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState<string>();
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await uploadFile(file, opts);
      setName(r.fileName);
      onUploaded(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx('space-y-1', className)}>
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={ALLOWED_MIME_TYPES.join(',')}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        {name ?? label ?? t('files.choose')}
      </button>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}

/** Open a signed download URL for an attachment (tab opened before the await — iPhone Safari, review C19). */
export function downloadAttachment(id: string) {
  return openSignedUrl(() => get<{ url: string }>(`/files/${id}/url`).then((r) => r.url));
}

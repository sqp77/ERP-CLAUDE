import type { ClientSession } from 'mongoose';
import { badRequest } from '../http/errors';
import { isSensitiveOwnerType } from '../access/registry';
import { Attachment } from './model';

/**
 * Attach uploaded files to the record that owns them (security review A3). Only files the actor
 * uploaded and that are not yet owned by another record can be claimed; afterwards access is decided
 * by the owner record's checker, and sensitivity follows the owner type.
 */
export async function claimAttachments(
  attachmentIds: readonly unknown[],
  ownerType: string,
  ownerId: string,
  uploadedBy: unknown,
  session?: ClientSession,
): Promise<void> {
  const ids = [...new Set(attachmentIds.map(String))];
  if (!ids.length) return;
  const claimable = await Attachment.countDocuments({
    _id: { $in: ids },
    uploadedBy,
    status: 'uploaded',
    deletedAt: null,
    $or: [{ ownerType: null }, { ownerType: { $exists: false } }, { ownerType, ownerId }],
  }).session(session ?? null);
  if (claimable !== ids.length) throw badRequest('أحد المرفقات غير صالح أو لا يخصك');
  const set: Record<string, unknown> = { ownerType, ownerId };
  if (isSensitiveOwnerType(ownerType)) set.sensitive = true;
  await Attachment.updateMany({ _id: { $in: ids } }, { $set: set }, { session });
}

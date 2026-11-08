import { getSetting } from '../settings/service';
import { notify } from '../notifications/service';
import { DocumentRecord } from './model';

/** Who gets expiry alerts for documents of an owner type. Registered by the owning module (HR for employees…). */
export type ExpiryRecipientResolver = (ownerId: string) => Promise<string[]>;
const resolvers = new Map<string, ExpiryRecipientResolver>();
export function registerExpiryRecipients(ownerType: string, fn: ExpiryRecipientResolver): void {
  resolvers.set(ownerType, fn);
}

/** Daily job: alert at each configured offset before expiry, once per offset. */
export async function runDocumentExpiryAlerts(now = new Date()): Promise<number> {
  const defaults = await getSetting('documents.expiryAlertOffsetsDays');
  const maxOffset = Math.max(...defaults, 0);
  const docs = await DocumentRecord.find({
    deletedAt: null,
    expiryDate: { $ne: null, $lte: new Date(now.getTime() + (maxOffset + 1) * 86_400_000) },
  });
  let sent = 0;
  // Only the latest version per owner + type is alerted (review G5); a superseded version is ignored even
  // when the newer one is outside the alert window.
  const current: typeof docs = [];
  for (const d of docs) {
    const newer = await DocumentRecord.exists({
      ownerType: d.ownerType,
      ownerId: d.ownerId,
      type: d.type,
      version: { $gt: d.version ?? 1 },
      deletedAt: null,
    });
    if (!newer) current.push(d);
  }
  for (const d of current) {
    const offsets = d.alertOffsetsDays?.length ? d.alertOffsetsDays : defaults;
    const daysLeft = Math.ceil((d.expiryDate!.getTime() - now.getTime()) / 86_400_000);
    // A document added inside the window gets only the nearest alert (review G5); farther offsets are marked passed.
    const due = offsets.filter((o) => daysLeft <= o && !d.alertsSent.includes(o));
    const nearest = due.length ? Math.min(...due) : undefined;
    for (const o of offsets) {
      if (due.includes(o) && o !== nearest) {
        d.alertsSent.push(o);
        continue;
      }
      if (daysLeft <= o && !d.alertsSent.includes(o)) {
        const resolve = resolvers.get(d.ownerType);
        const userIds = resolve ? await resolve(d.ownerId) : [];
        if (userIds.length) {
          await notify({
            userIds,
            type: 'document.expiring',
            bodyAr: `${d.titleAr} — متبقٍ ${Math.max(daysLeft, 0)} يومًا`,
            data: { documentId: String(d._id), ownerType: d.ownerType, ownerId: d.ownerId },
          });
          sent++;
        }
        d.alertsSent.push(o);
      }
    }
    if (d.isModified()) await d.save();
  }
  return sent;
}

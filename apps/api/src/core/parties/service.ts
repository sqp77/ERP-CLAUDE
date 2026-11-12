import type { ClientSession } from 'mongoose';
import { normalizeArabic } from '@eayni/shared';
import { Party, type PartyDoc } from './model';

export interface PartyIdentity {
  legalNameAr: string;
  crNumber?: string;
  unifiedNumber?: string;
  vatNumber?: string;
  nationalAddress?: string;
  email?: string;
  phone?: string;
}

/** A party already registered under the same CR / unified / VAT number, if any (FIN §8 duplicate block). */
export async function findPartyByNumbers(id: PartyIdentity, session?: ClientSession) {
  const or: Record<string, string>[] = [];
  if (id.crNumber) or.push({ crNumber: id.crNumber });
  if (id.unifiedNumber) or.push({ unifiedNumber: id.unifiedNumber });
  if (id.vatNumber) or.push({ vatNumber: id.vatNumber });
  if (!or.length) return null;
  return Party.findOne({ deletedAt: null, $or: or }).session(session ?? null);
}

/**
 * Reuse the party that carries the same official numbers, or create one with the `customer` role (golden rule 2:
 * one master record; the customer file references it). An existing supplier gains the customer role.
 */
export async function ensureCustomerParty(
  id: PartyIdentity,
  session?: ClientSession,
): Promise<PartyDoc & { _id: unknown }> {
  const existing = await findPartyByNumbers(id, session);
  if (existing) {
    if (!existing.roles.includes('customer')) {
      existing.roles.push('customer');
      await existing.save({ session: session ?? undefined });
    }
    return existing;
  }
  const [doc] = await Party.create(
    [{ ...id, normalizedName: normalizeArabic(id.legalNameAr), roles: ['customer'] }],
    { session: session ?? undefined },
  );
  return doc;
}

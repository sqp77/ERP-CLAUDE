import { canAccessRecord, registerRecordAccess } from '../access/registry';

/** Documents share the platform record-access registry (see core/access/registry.ts). */
export const registerDocumentAccess = registerRecordAccess;
export const canAccessDocuments = canAccessRecord;

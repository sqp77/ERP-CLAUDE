import type { ClientSession } from 'mongoose';
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowDefinitionInput,
  type WorkflowFields,
} from '@eayni/shared';
import { badRequest, conflict, forbidden } from '../http/errors';
import type { Actor } from '../http/context';
import { addBusinessDays, loadHolidaySet } from '../dates/businessDays';
import { StageLog, WorkflowDef } from './model';

const cache = new Map<string, { def: WorkflowDefinition; at: number }>();
const TTL_MS = 10_000;

export function clearWorkflowCache(): void {
  cache.clear();
}

export async function getWorkflow(type: string): Promise<WorkflowDefinition> {
  const hit = cache.get(type);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.def;
  const doc = await WorkflowDef.findOne({ type }).lean();
  if (!doc) throw new Error(`workflow "${type}" is not configured`);
  const def = workflowDefinitionSchema.parse(doc);
  cache.set(type, { def, at: Date.now() });
  return def;
}

/**
 * Insert a default definition when none exists. A stored default that was never edited by an admin is
 * upgraded when the shipped default has a higher version; admin-edited definitions are preserved.
 */
export async function ensureWorkflow(input: WorkflowDefinitionInput): Promise<void> {
  const def = workflowDefinitionSchema.parse(input);
  const existing = await WorkflowDef.findOne({ type: def.type }).select('version updatedBy').lean();
  if (!existing) await WorkflowDef.updateOne({ type: def.type }, { $setOnInsert: def }, { upsert: true });
  else if (!existing.updatedBy && (existing.version ?? 1) < def.version)
    await WorkflowDef.updateOne({ type: def.type }, { $set: def });
  cache.delete(def.type);
}

export async function saveWorkflow(
  input: WorkflowDefinitionInput,
  updatedBy?: string,
): Promise<WorkflowDefinition> {
  const def = workflowDefinitionSchema.parse(input);
  await WorkflowDef.updateOne({ type: def.type }, { $set: { ...def, updatedBy } }, { upsert: true });
  cache.delete(def.type);
  return def;
}

async function dueFor(def: WorkflowDefinition, state: string, from: Date): Promise<Date | null> {
  const sla = def.states[state]?.slaBusinessDays;
  if (!sla) return null;
  return addBusinessDays(from, sla, await loadHolidaySet());
}

/** Fields for a freshly created record. */
export async function initWorkflow(def: WorkflowDefinition, now = new Date()): Promise<WorkflowFields> {
  return {
    state: def.initialState,
    stateEnteredAt: now,
    dueAt: await dueFor(def, def.initialState, now),
    closedAt: null,
  };
}

export interface TransitionArgs {
  def: WorkflowDefinition;
  record: WorkflowFields & { _id?: unknown; number?: string } & Record<string, unknown>;
  recordType: string;
  transition: string;
  actor: Actor;
  /** 'requester', 'assignee', 'direct_manager', 'department_manager', role codes… computed by the caller. */
  actorRelations: string[];
  /** Field values after the transition's payload is applied; checked against requiredFields. */
  payload?: Record<string, unknown>;
  reason?: string;
  delayReason?: string;
  departmentId?: string;
  now?: Date;
  session?: ClientSession;
  /**
   * Persist the new fields with a conditional update on { _id, state: fromState } and return whether a
   * document was updated (review B9). When it returns false the engine throws 409 and writes no stage
   * log. When omitted the caller persists after the call (legacy behaviour).
   */
  persist?: (fields: WorkflowFields, session?: ClientSession) => Promise<boolean>;
}

export interface TransitionResult {
  fields: WorkflowFields;
  to: string;
  category: WorkflowDefinition['states'][string]['category'];
}

export function availableTransitions(def: WorkflowDefinition, state: string, actorRelations: string[]) {
  const rel = new Set(actorRelations);
  return def.transitions.filter(
    (t) => t.from.includes(state) && (t.allow.includes('*') || t.allow.some((a) => rel.has(a))),
  );
}

/**
 * Validate and apply one transition. Returns the new workflow fields and appends the stage log — after
 * `persist` succeeded, so a lost race never leaves a stage-log row behind.
 */
export async function applyTransition(args: TransitionArgs): Promise<TransitionResult> {
  const { def, record, transition, actorRelations } = args;
  const now = args.now ?? new Date();
  const t = def.transitions.find((x) => x.code === transition);
  if (!t) throw badRequest(`إجراء غير معروف: ${transition}`);
  if (!t.from.includes(record.state))
    throw badRequest(`لا يمكن تنفيذ "${t.labelAr}" من الحالة الحالية`, { state: record.state });
  const rel = new Set(actorRelations);
  if (!(t.allow.includes('*') || t.allow.some((a) => rel.has(a))))
    throw forbidden(`ليست لديك صلاحية تنفيذ "${t.labelAr}"`);
  if (t.requireReason && !args.reason?.trim()) throw badRequest('السبب مطلوب لهذا الإجراء');
  const merged = { ...record, ...(args.payload ?? {}) } as Record<string, unknown>;
  const missing = t.requiredFields.filter(
    (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
  );
  if (missing.length) throw badRequest('حقول مطلوبة ناقصة', { missing });

  const toState = def.states[t.to];
  const durationMs = now.getTime() - new Date(record.stateEnteredAt).getTime();
  const overdue = !!record.dueAt && new Date(record.dueAt) < now;
  const closed = toState.category === 'done' || toState.category === 'cancelled';
  const fields: WorkflowFields = {
    state: t.to,
    stateEnteredAt: now,
    dueAt: closed ? null : await dueFor(def, t.to, now),
    closedAt: closed ? now : null,
  };
  if (args.persist && !(await args.persist(fields, args.session)))
    throw conflict('تغيّرت حالة السجل من مستخدم آخر أثناء العمل عليه، حدّث الصفحة وأعد المحاولة', {
      state: record.state,
    });
  await StageLog.create(
    [
      {
        recordType: args.recordType,
        recordId: String(record._id ?? ''),
        recordNumber: record.number,
        fromState: record.state,
        toState: t.to,
        transition: t.code,
        actorUserId: args.actor.userId,
        actorEmail: args.actor.email,
        actorRelations,
        at: now,
        reason: args.reason,
        durationMs,
        overdue,
        delayReason: args.delayReason,
        departmentId: args.departmentId,
      },
    ],
    { session: args.session },
  );
  return { fields, to: t.to, category: toState.category };
}

export async function stageHistory(recordType: string, recordId: string) {
  return StageLog.find({ recordType, recordId }).sort({ at: 1 }).lean();
}

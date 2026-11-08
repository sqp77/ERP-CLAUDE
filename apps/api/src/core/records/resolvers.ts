/**
 * Record resolvers (core): the module owning a record type registers how to find one by id or number
 * and how to label it. Used wherever another record links to it — task sources, calendar links,
 * comments headers — without cross-module model imports.
 */
export type RecordResolver = (idOrNumber: string) => Promise<{ id: string; label: string } | null>;
const resolvers = new Map<string, RecordResolver>();
export function registerRecordResolver(type: string, fn: RecordResolver): void {
  resolvers.set(type, fn);
}
export async function resolveRecord(type: string, idOrNumber: string) {
  const fn = resolvers.get(type);
  return fn ? fn(idOrNumber) : null;
}
export function resolvableRecordTypes(): string[] {
  return [...resolvers.keys()];
}

/** People search for pickers (participants, assignees): HR registers it over the employee file. */
export interface Person {
  userId: string;
  fullNameAr: string;
  departmentId?: string;
  positionId?: string;
}
let peopleSearch: (q: string, limit: number) => Promise<Person[]> = async () => [];
export function registerPeopleSearch(fn: typeof peopleSearch): void {
  peopleSearch = fn;
}
export const searchPeople = (q: string, limit = 20) => peopleSearch(q, limit);

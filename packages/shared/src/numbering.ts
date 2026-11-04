/** Document number prefixes: `PREFIX-YYYY-#####` from an atomic counter (CLAUDE.md "Numbering"). */
export const NUMBER_PREFIXES = {
  ticket: 'TKT',
  hrRequest: 'HRQ',
  employee: 'EMP',
  task: 'TSK',
  event: 'EVT',
  employeeReport: 'RPT',
  news: 'NWS',
  document: 'DOC',
  purchaseRequest: 'PRQ',
  financialRequest: 'FRQ',
  export: 'EXP',
  contract: 'CNT',
  profileChange: 'PCR',
} as const;
export type NumberPrefixKey = keyof typeof NUMBER_PREFIXES;
export const NUMBER_PATTERN = /^[A-Z]{2,5}-\d{4}-\d{5,}$/;

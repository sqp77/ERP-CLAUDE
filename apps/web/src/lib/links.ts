/**
 * One place that knows where a record lives in the app (go-live review H6). Every "linked record"
 * chip, task source, calendar link and notification uses it instead of building paths by hand.
 */
const ROUTES: Record<string, (id: string) => string> = {
  task: (id) => `/tasks/${id}`,
  ticket: (id) => `/tickets/${id}`,
  hr_request: (id) => `/hr/requests/${id}`,
  employee_report: (id) => `/reports/${id}`,
  news: (id) => `/news/${id}`,
  employee: (id) => `/hr/employees/${id}`,
  calendar_event: (id) => `/calendar?event=${id}`,
  customer: (id) => `/sales/customers/${id}`,
  opportunity: (id) => `/sales/pipeline?opportunity=${id}`,
  lead: (id) => `/sales/leads?lead=${id}`,
  sales_request: (id) => `/sales/requests/${id}`,
};

export function recordLink(type: string | undefined, id: string | undefined): string | undefined {
  if (!type || !id) return undefined;
  const fn = ROUTES[type];
  return fn ? fn(encodeURIComponent(id)) : undefined;
}

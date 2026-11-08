import type { RoleAssignment } from '@eayni/shared';
import { registerJob } from '../../core/jobs/registry';
import { registerRecordAccess } from '../../core/access/registry';
import { effectivePermission } from '../../core/rbac/service';
import { News } from './model';
import { visibilityFilter } from './service';
import { runNewsWindows } from './jobs';

let registered = false;
export function registerNewsModule(): void {
  if (registered) return;
  registered = true;
  // Attachments and images follow the item's visibility (published → its audience; drafts → author / department).
  registerRecordAccess('news', async (req, id) => {
    const eff = await effectivePermission(
      req.auth.user.roles as RoleAssignment[],
      req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined,
      'news',
      'view',
      String(req.auth.user._id),
    );
    if (!eff) return false;
    return !!(await News.exists({
      _id: id,
      deletedAt: null,
      ...(await visibilityFilter(req.auth.user, { resource: 'news', action: 'view', ...eff })),
    }));
  });
  registerJob('news.windows', (now) => runNewsWindows(now), 'frequent');
}

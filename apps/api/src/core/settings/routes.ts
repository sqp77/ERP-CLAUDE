import { Router } from 'express';
import { z } from 'zod';
import { SETTING_KEYS, type SettingKey } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { listSettings, setSetting } from './service';
import { notifySystemAdmins } from '../notifications/alerts';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  requireAuth(),
  authorize('settings', 'view'),
  asyncHandler(async (_req, res) => {
    res.json({ items: await listSettings() });
  }),
);

settingsRouter.put(
  '/:key',
  requireAuth(),
  authorize('settings', 'edit'),
  validate(z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]) }), 'params'),
  validate(z.object({ value: z.unknown() })),
  asyncHandler(async (req: AuthedRequest, res) => {
    const key = req.params.key as SettingKey;
    const value = await setSetting(key, (req.body as { value: unknown }).value, actorFrom(req));
    // Authentication policy changes reach every other system admin (review D24).
    if (key.startsWith('auth.'))
      await notifySystemAdmins({
        bodyAr: `تم تغيير إعداد المصادقة ${key} بواسطة ${req.auth.user.email}`,
        link: '/admin/settings',
        data: { kind: 'setting', key, value },
        excludeUserId: String(req.auth.user._id),
      });
    res.json({ key, value });
  }),
);

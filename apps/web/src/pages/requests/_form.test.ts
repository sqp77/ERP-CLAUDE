import { describe, expect, it } from 'vitest';
import { detailsFromForm, formFromDetails } from './_form';
import { ApiError } from '@/lib/api';
import { fieldErrorsFrom } from '@/lib/errors';

describe('C19 — one form for new and resubmitted requests', () => {
  it('maps form values to request details and back for every type', () => {
    const advance = detailsFromForm('advance', { amount: '1500.50', reason: 'ظرف طارئ', notes: '' });
    expect(advance).toEqual({ amountHalalas: 150_050, reason: 'ظرف طارئ', notes: undefined });
    expect(formFromDetails('advance', advance)).toMatchObject({ amount: '1500.5', reason: 'ظرف طارئ' });
    const leave = detailsFromForm('leave', {
      leaveType: 'annual',
      startDate: '2026-12-01',
      endDate: '2026-12-10',
      reason: 'إجازة',
    });
    expect(formFromDetails('leave', leave)).toMatchObject({ leaveType: 'annual', startDate: '2026-12-01' });
    const du = detailsFromForm('data_update', {
      field: 'mobile',
      currentValue: '',
      newValue: '0555',
      reason: '',
    });
    expect(du).toEqual({
      changes: [{ field: 'mobile', currentValue: undefined, newValue: '0555' }],
      reason: undefined,
    });
    expect(formFromDetails('data_update', du)).toMatchObject({ field: 'mobile', newValue: '0555' });
  });
  it('turns the API validation details into field errors', () => {
    const e = new ApiError(400, 'validation_error', 'بيانات غير صالحة', [
      { path: 'details.endDate', message: 'تاريخ النهاية قبل البداية' },
      { path: 'reason', message: 'مطلوب' },
    ]);
    expect(fieldErrorsFrom(e)).toEqual({ endDate: 'تاريخ النهاية قبل البداية', reason: 'مطلوب' });
    expect(fieldErrorsFrom(new Error('x'))).toEqual({});
  });
});

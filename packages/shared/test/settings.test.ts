import { describe, expect, it } from 'vitest';
import { isAdminEditableSettingKey } from '../src/settings.js';

describe('isAdminEditableSettingKey', () => {
  it('refuses budget.* and the poll subset, in any case or padding', () => {
    for (const k of [
      'budget.max_share',
      'budget.anything',
      ' Budget.Max_Share',
      'poll.subset_external_ids',
      '',
    ]) {
      expect(isAdminEditableSettingKey(k)).toBe(false);
    }
  });
  it('allows other keys', () => {
    for (const k of ['poll.interval_seconds', 'retention.packet_days']) {
      expect(isAdminEditableSettingKey(k)).toBe(true);
    }
  });
});

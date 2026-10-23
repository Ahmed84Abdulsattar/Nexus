/**
 * Which `core.setting` keys an admin screen or API endpoint may write (S9 settings admin).
 *
 * `nexus_api` has INSERT and UPDATE on `core.setting`, and the DATOMS quota is shared by the whole
 * organisation (ADR 0005). So the keys that decide how much of that quota a worker may spend are
 * not editable through the API: `budget.*`, and `poll.subset_external_ids` (setting it to null makes
 * a non-prod worker poll the full fleet). They are set by migrations, seeds and deployment only.
 * The worker also enforces DATOMS_MAX_SHARE_CEILING on top (docs/07 section 4).
 *
 * A settings-write endpoint MUST call `isAdminEditableSettingKey` before writing, and answer a
 * refused key with 403 (the key is known, the caller may not change it). Default deny: a future
 * endpoint should also keep its own allowlist of editable keys.
 */
export const ADMIN_SETTING_DENY_PREFIXES = ['budget.'] as const;
export const ADMIN_SETTING_DENY_KEYS = ['poll.subset_external_ids'] as const;

export function isAdminEditableSettingKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (k === '') return false;
  if (ADMIN_SETTING_DENY_PREFIXES.some((p) => k.startsWith(p))) return false;
  return !(ADMIN_SETTING_DENY_KEYS as readonly string[]).includes(k);
}

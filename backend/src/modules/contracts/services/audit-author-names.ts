type AuditRecord = Record<string, any>;
const fields = ['created_by', 'updated_by', 'validated_by'] as const;
const name = (value: unknown): string | null => typeof value === 'string' && value.trim() && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.trim()) ? value.trim().slice(0, 200) : null;
/** Enrich only actors referenced by records already authorized for this tenant.
 * Names are current display labels; original IDs and immutable snapshots remain intact.
 * Directory failures must never make a successful write appear to have failed.
 */
export async function auditAuthorNames(client: any, organizationId: string, rows: AuditRecord[]): Promise<AuditRecord[]> {
 const records = rows.flatMap(row => [row, ...(row.snapshot && typeof row.snapshot === 'object' ? [row.snapshot] : [])]).filter(row => row.organization_id === organizationId);
 const ids = [...new Set(records.flatMap(row => fields.map(key => row[key]).filter(id => typeof id === 'string' && id.length > 0)))];
 const names = new Map<string, string>();
 for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100), allowed = new Set(batch);
  try {
   const members = await client.from('organization_members').select('user_id,organization_id,display_name').eq('organization_id', organizationId).in('user_id', batch);
   if (!members.error && Array.isArray(members.data)) for (const row of members.data) {
    const label = name(row.display_name);
    if (row.organization_id === organizationId && allowed.has(row.user_id) && label) names.set(row.user_id, label);
   }
  } catch { /* A missing directory label does not invalidate the audit record. */ }
  const missing = batch.filter(id => !names.has(id));
  if (!missing.length) continue;
  try {
   const profiles = await client.from('user_profiles').select('user_id,name').in('user_id', missing);
   if (!profiles.error && Array.isArray(profiles.data)) for (const row of profiles.data) {
    const label = name(row.name);
    if (missing.includes(row.user_id) && label) names.set(row.user_id, label);
   }
  } catch { /* Keep an explicit unnamed actor, including for former users. */ }
 }
 const enrich = (row: AuditRecord) => ({...row, ...Object.fromEntries(fields.map(key => [key + '_name', row.organization_id === organizationId ? names.get(row[key]) ?? null : null]))});
 return rows.map(row => ({...enrich(row), ...(row.snapshot && typeof row.snapshot === 'object' ? {snapshot: enrich(row.snapshot)} : {})}));
}

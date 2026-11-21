import type {Table} from 'dexie';
import {db} from '../db/database';
import type {
  AuditAction,
  AuditLogRecord,
  PermissionKey,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';

export async function withReadTx<T>(
  tables: Table<unknown, string>[],
  fn: () => Promise<T>
): Promise<T> {
  return db.transaction('r', tables, fn);
}

export async function withWriteTx<T>(
  tables: Table<unknown, string>[],
  fn: () => Promise<T>
): Promise<T> {
  return db.transaction('rw', tables, fn);
}

export async function getActorPermissionsSet(actor: UserRecord): Promise<Set<PermissionKey>> {
  const role = await db.roles.get(actor.roleId);
  return new Set(role?.permissions ?? []);
}

export async function requirePermission(
  actor: UserRecord,
  permission: PermissionKey,
  errorMessage = 'ليس لديك الصلاحية المطلوبة لتنفيذ هذا الإجراء.'
): Promise<Set<PermissionKey>> {
  const perms = await getActorPermissionsSet(actor);
  if (!perms.has(permission)) {
    throw new Error(errorMessage);
  }
  return perms;
}

export async function appendAuditLog(params: {
  actorUserId: UUID;
  actorName: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  details?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<AuditLogRecord> {
  const now = Date.now();
  const payload: Record<string, unknown> = {
    ...(params.details ?? {}),
    ...(params.before !== undefined ? {before: params.before} : {}),
    ...(params.after !== undefined ? {after: params.after} : {}),
  };

  const entry: AuditLogRecord = {
    id: generateUUID(),
    actorUserId: params.actorUserId,
    actorName: params.actorName,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.summary,
    detailsJson: JSON.stringify(payload),
    createdAt: now,
    updatedAt: now,
    createdBy: params.actorUserId,
  };
  await db.audit_log.add(entry);
  return entry;
}

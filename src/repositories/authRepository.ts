import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  AuthenticatedSession,
  PermissionKey,
  RoleRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateSalt, generateUUID, hashPin, verifyPin} from '../utils/crypto';
import {appendAuditLog, requirePermission, withReadTx, withWriteTx} from './baseRepository';

export interface LoginUserSummary {
  id: UUID;
  name: string;
  username: string;
  roleNameAr: string;
}

export interface UserWithRole extends UserRecord {
  roleNameAr: string;
  roleCode: RoleRecord['code'];
}

function buildSession(user: UserRecord, role: RoleRecord): AuthenticatedSession {
  return {
    user,
    role,
    permissions: new Set<PermissionKey>(role.permissions),
  };
}

export const authRepository = {
  async hasAnyUsers(): Promise<boolean> {
    await runDatabaseMigrations();
    return withReadTx([db.users], async () => {
      const count = await db.users.count();
      return count > 0;
    });
  },

  async listActiveUsersForLogin(): Promise<LoginUserSummary[]> {
    await runDatabaseMigrations();
    return withReadTx([db.users, db.roles], async () => {
      const [users, roles] = await Promise.all([db.users.toArray(), db.roles.toArray()]);
      const roleMap = new Map(roles.map((r) => [r.id, r]));
      return users
        .filter((u) => u.isActive)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((u) => ({
          id: u.id,
          name: u.name,
          username: u.username,
          roleNameAr: roleMap.get(u.roleId)?.nameAr ?? 'مستخدم',
        }));
    });
  },

  async listRoles(): Promise<RoleRecord[]> {
    await runDatabaseMigrations();
    return withReadTx([db.roles], async () => {
      return db.roles.toArray();
    });
  },

  async listAllUsers(): Promise<UserWithRole[]> {
    await runDatabaseMigrations();
    return withReadTx([db.users, db.roles], async () => {
      const [users, roles] = await Promise.all([db.users.toArray(), db.roles.toArray()]);
      const roleMap = new Map(roles.map((r) => [r.id, r]));
      return users
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((u) => {
          const role = roleMap.get(u.roleId);
          return {
            ...u,
            roleNameAr: role?.nameAr ?? 'غير محدد',
            roleCode: role?.code ?? 'sales',
          };
        });
    });
  },

  async createInitialAdmin(input: {
    name: string;
    username: string;
    pin: string;
    companyName?: string;
  }): Promise<AuthenticatedSession> {
    await runDatabaseMigrations();
    const trimmedName = input.name.trim();
    const trimmedUsername = input.username.trim().toLowerCase();
    const trimmedPin = input.pin.trim();

    if (trimmedName.length < 2) {
      throw new Error('يرجى إدخال الاسم الكامل لمدير النظام.');
    }
    if (trimmedUsername.length < 2) {
      throw new Error('يرجى إدخال اسم الدخول (حرفان على الأقل).');
    }
    if (!/^\d{4,8}$/.test(trimmedPin)) {
      throw new Error('يجب أن يتكون رمز PIN من 4 إلى 8 أرقام.');
    }

    const salt = generateSalt();
    const pinHash = await hashPin(trimmedPin, salt);

    return withWriteTx([db.users, db.roles, db.company_settings, db.audit_log], async () => {
      const existingCount = await db.users.count();
      if (existingCount > 0) {
        throw new Error('تم تهيئة مدير النظام مسبقاً.');
      }

      const adminRole = await db.roles.where('code').equals('admin').first();
      if (!adminRole) {
        throw new Error('تعذر العثور على دور مدير النظام.');
      }

      const now = Date.now();
      const userId = generateUUID();

      const adminUser: UserRecord = {
        id: userId,
        name: trimmedName,
        username: trimmedUsername,
        pinHash,
        pinSalt: salt,
        roleId: adminRole.id,
        isActive: true,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      };

      await db.users.add(adminUser);

      if (input.companyName && input.companyName.trim().length > 0) {
        await db.company_settings.update('default', {
          companyName: input.companyName.trim(),
          updatedAt: now,
        });
      }

      await appendAuditLog({
        actorUserId: adminUser.id,
        actorName: adminUser.name,
        action: 'create',
        entityType: 'users',
        entityId: adminUser.id,
        summary: `إنشاء حساب مدير النظام الأول: ${adminUser.name}`,
        details: {roleCode: adminRole.code},
      });

      return buildSession(adminUser, adminRole);
    });
  },

  async authenticateWithPin(identifier: string, pin: string): Promise<AuthenticatedSession> {
    await runDatabaseMigrations();
    const normalized = identifier.trim().toLowerCase();
    const trimmedPin = pin.trim();

    if (!normalized) {
      throw new Error('يرجى إدخال اسم المستخدم أو اختيار الحساب.');
    }
    if (!trimmedPin) {
      throw new Error('يرجى إدخال رمز PIN.');
    }

    const candidate = await withReadTx([db.users], async () => {
      const allUsers = await db.users.toArray();
      return (
        allUsers.find(
          (u) =>
            u.username.toLowerCase() === normalized ||
            u.name.trim().toLowerCase() === normalized ||
            u.id === identifier
        ) ?? null
      );
    });

    if (!candidate) {
      throw new Error('اسم المستخدم أو رمز PIN غير صحيح.');
    }
    if (!candidate.isActive) {
      throw new Error('هذا الحساب معطّل. يرجى مراجعة مدير النظام.');
    }

    const valid = await verifyPin(trimmedPin, candidate.pinSalt, candidate.pinHash);
    if (!valid) {
      throw new Error('اسم المستخدم أو رمز PIN غير صحيح.');
    }

    return withWriteTx([db.users, db.roles, db.audit_log], async () => {
      const user = await db.users.get(candidate.id);
      if (!user || !user.isActive) {
        throw new Error('تعذر تسجيل الدخول لهذا الحساب.');
      }
      const role = await db.roles.get(user.roleId);
      if (!role) {
        throw new Error('تعذر تحميل صلاحيات المستخدم.');
      }

      const now = Date.now();
      await db.users.update(user.id, {lastLoginAt: now, updatedAt: now});
      const updatedUser: UserRecord = {...user, lastLoginAt: now, updatedAt: now};

      await appendAuditLog({
        actorUserId: updatedUser.id,
        actorName: updatedUser.name,
        action: 'login',
        entityType: 'users',
        entityId: updatedUser.id,
        summary: `تسجيل دخول: ${updatedUser.name} (${role.nameAr})`,
      });

      return buildSession(updatedUser, role);
    });
  },

  async restoreSessionByUserId(userId: UUID): Promise<AuthenticatedSession | null> {
    await runDatabaseMigrations();
    return withReadTx([db.users, db.roles], async () => {
      const user = await db.users.get(userId);
      if (!user || !user.isActive) {
        return null;
      }
      const role = await db.roles.get(user.roleId);
      if (!role) {
        return null;
      }
      return buildSession(user, role);
    });
  },

  async createUser(
    actor: UserRecord,
    input: {name: string; username: string; pin: string; roleId: UUID}
  ): Promise<UserRecord> {
    const trimmedName = input.name.trim();
    const trimmedUsername = input.username.trim().toLowerCase();
    const trimmedPin = input.pin.trim();

    if (trimmedName.length < 2) {
      throw new Error('الاسم يجب أن لا يقل عن حرفين.');
    }
    if (trimmedUsername.length < 2) {
      throw new Error('اسم الدخول يجب أن لا يقل عن حرفين.');
    }
    if (!/^\d{4,8}$/.test(trimmedPin)) {
      throw new Error('رمز PIN يجب أن يتكون من 4 إلى 8 أرقام.');
    }

    const salt = generateSalt();
    const pinHash = await hashPin(trimmedPin, salt);

    return withWriteTx([db.users, db.roles, db.audit_log], async () => {
      await requirePermission(
        actor,
        'users.manage',
        'ليس لديك صلاحية إضافة مستخدمين جدد.'
      );

      const duplicate = await db.users.where('username').equals(trimmedUsername).first();
      if (duplicate) {
        throw new Error('اسم الدخول مستخدم بالفعل.');
      }
      const role = await db.roles.get(input.roleId);
      if (!role) {
        throw new Error('الدور المحدد غير موجود.');
      }

      const now = Date.now();

      const user: UserRecord = {
        id: generateUUID(),
        name: trimmedName,
        username: trimmedUsername,
        pinHash,
        pinSalt: salt,
        roleId: role.id,
        isActive: true,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      };

      await db.users.add(user);
      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'users',
        entityId: user.id,
        summary: `إضافة مستخدم جديد: ${user.name} بدور ${role.nameAr}`,
        after: {
          name: user.name,
          username: user.username,
          roleCode: role.code,
          roleNameAr: role.nameAr,
          isActive: user.isActive,
        },
      });

      return user;
    });
  },

  async updateUserRoleAndStatus(
    actor: UserRecord,
    userId: UUID,
    patch: {name?: string; roleId?: UUID; isActive?: boolean}
  ): Promise<void> {
    return withWriteTx([db.users, db.roles, db.audit_log], async () => {
      await requirePermission(
        actor,
        'users.manage',
        'ليس لديك صلاحية تعديل بيانات أو أدوار المستخدمين.'
      );

      const target = await db.users.get(userId);
      if (!target) {
        throw new Error('المستخدم غير موجود.');
      }
      if (target.id === actor.id && patch.isActive === false) {
        throw new Error('لا يمكن تعطيل حسابك الحالي أثناء تسجيل الدخول.');
      }

      const nextName = patch.name !== undefined ? patch.name.trim() : target.name;
      const nextRoleId = patch.roleId !== undefined ? patch.roleId : target.roleId;
      const nextIsActive = patch.isActive !== undefined ? patch.isActive : target.isActive;

      const now = Date.now();
      await db.users.update(userId, {
        ...(patch.name !== undefined ? {name: nextName} : {}),
        ...(patch.roleId !== undefined ? {roleId: nextRoleId} : {}),
        ...(patch.isActive !== undefined ? {isActive: nextIsActive} : {}),
        updatedAt: now,
      });

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'users',
        entityId: userId,
        summary: `تحديث بيانات/صلاحيات المستخدم: ${target.name}`,
        before: {
          name: target.name,
          roleId: target.roleId,
          isActive: target.isActive,
        },
        after: {
          name: nextName,
          roleId: nextRoleId,
          isActive: nextIsActive,
        },
      });
    });
  },

  async resetUserPin(actor: UserRecord, userId: UUID, newPin: string): Promise<void> {
    const trimmedPin = newPin.trim();
    if (!/^\d{4,8}$/.test(trimmedPin)) {
      throw new Error('رمز PIN الجديد يجب أن يتكون من 4 إلى 8 أرقام.');
    }

    const salt = generateSalt();
    const pinHash = await hashPin(trimmedPin, salt);

    return withWriteTx([db.roles, db.users, db.audit_log], async () => {
      await requirePermission(
        actor,
        'users.manage',
        'ليس لديك صلاحية إعادة تعيين رمز PIN للمستخدمين.'
      );

      const target = await db.users.get(userId);
      if (!target) {
        throw new Error('المستخدم غير موجود.');
      }
      const now = Date.now();
      await db.users.update(userId, {pinSalt: salt, pinHash, updatedAt: now});

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'users',
        entityId: userId,
        summary: `إعادة تعيين رمز PIN للمستخدم: ${target.name}`,
        details: {pinReset: true},
      });
    });
  },

  async updateRolePermissions(
    actor: UserRecord,
    roleId: UUID,
    permissions: PermissionKey[]
  ): Promise<RoleRecord> {
    return withWriteTx([db.roles, db.audit_log], async () => {
      await requirePermission(
        actor,
        'users.manage',
        'ليس لديك صلاحية تعديل مصفوفة الصلاحيات.'
      );

      const role = await db.roles.get(roleId);
      if (!role) {
        throw new Error('الدور غير موجود.');
      }
      if (role.code === 'admin' && !permissions.includes('users.manage')) {
        throw new Error('لا يمكن سحب صلاحية إدارة المستخدمين من دور مدير النظام.');
      }
      const unique = Array.from(new Set(permissions));
      const now = Date.now();
      await db.roles.update(roleId, {permissions: unique, updatedAt: now});

      const updated: RoleRecord = {...role, permissions: unique, updatedAt: now};
      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'roles',
        entityId: roleId,
        summary: `تحديث صلاحيات دور: ${role.nameAr}`,
        before: {permissions: role.permissions},
        after: {permissions: unique},
      });
      return updated;
    });
  },

  async recordLogout(actor: UserRecord): Promise<void> {
    return withWriteTx([db.audit_log], async () => {
      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'logout',
        entityType: 'users',
        entityId: actor.id,
        summary: `تسجيل خروج: ${actor.name}`,
      });
    });
  },
};

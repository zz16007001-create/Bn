import {Check, History, KeyRound, Lock, Search, ShieldCheck, UserPlus} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {
  AUDIT_ACTION_LABELS,
  auditRepository,
  ENTITY_TYPE_LABELS,
  type ParsedAuditEntry,
} from '../repositories/auditRepository';
import {authRepository, type UserWithRole} from '../repositories/authRepository';
import {
  PERMISSION_DEFINITIONS,
  type AuditAction,
  type PermissionKey,
  type RoleRecord,
} from '../types/domain';
import {formatArabicDateTime} from '../utils/date';

const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: 'الاسم',
  sku: 'الكود',
  barcode: 'الباركود',
  category: 'التصنيف',
  costPricePiastres: 'سعر الشراء (قرش)',
  wholesalePricePiastres: 'سعر الجملة (قرش)',
  retailPricePiastres: 'سعر التجزئة (قرش)',
  minStockQty: 'الحد الأدنى',
  isActive: 'الحالة نشط',
  phone: 'الهاتف',
  address: 'العنوان',
  area: 'المنطقة',
  creditLimitPiastres: 'حد الائتمان (قرش)',
  roleId: 'معرّف الدور',
  permissions: 'الصلاحيات',
  status: 'الحالة',
  location: 'الموقع',
  isDefault: 'افتراضي',
  companyName: 'اسم الشركة',
  thermalPaperWidth: 'مقاس ورق الطباعة',
  autoPrintAfterSale: 'طباعة تلقائية',
  allowNegativeStock: 'السماح بالمخزون السالب',
  invoiceFooter: 'تذييل الفاتورة',
  taxNumber: 'الرقم الضريبي',
  pinReset: 'تغيير رمز PIN',
};

function formatDiffValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'نعم' : 'لا';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export const UsersPermissionsPage: React.FC = () => {
  const {session, can, refreshSession} = useAuth();
  const canManage = can('users.manage');

  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'audit'>('users');
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // Add user form
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset PIN modal
  const [pinTarget, setPinTarget] = useState<UserWithRole | null>(null);
  const [resetPinValue, setResetPinValue] = useState('');

  // Audit Log viewer state
  const [auditEntries, setAuditEntries] = useState<ParsedAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActorId, setAuditActorId] = useState<string>('all');
  const [auditAction, setAuditAction] = useState<AuditAction | 'all'>('all');
  const [auditEntity, setAuditEntity] = useState<string>('all');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uList, rList] = await Promise.all([
        authRepository.listAllUsers(),
        authRepository.listRoles(),
      ]);
      setUsers(uList);
      setRoles(rList);
      setNewRoleId((prev) => prev || rList.find((r) => r.code === 'sales')?.id || rList[0]?.id || '');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    if (!session || !canManage) return;
    setAuditLoading(true);
    try {
      const entries = await auditRepository.listAuditLogs(session.user, {
        actorUserId: auditActorId,
        action: auditAction,
        entityType: auditEntity,
        dateFrom: auditDateFrom || undefined,
        dateTo: auditDateTo || undefined,
        search: auditSearch || undefined,
        limit: 250,
      });
      setAuditEntries(entries);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل سجل المراجعة.',
      });
    } finally {
      setAuditLoading(false);
    }
  }, [
    session,
    canManage,
    auditActorId,
    auditAction,
    auditEntity,
    auditDateFrom,
    auditDateTo,
    auditSearch,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'audit') {
      void loadAuditLogs();
    }
  }, [activeTab, loadAuditLogs]);

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center max-w-md mx-auto">
        <Lock className="w-10 h-10 text-amber-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-[#0B1F3A]">صلاحية مقيدة</h2>
        <p className="mt-2 text-sm text-slate-600">
          إدارة المستخدمين والصلاحيات وسجل المراجعة متاحة فقط لمن يمتلك صلاحية "إدارة المستخدمين".
        </p>
      </div>
    );
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setFeedback(null);
    setCreating(true);
    try {
      await authRepository.createUser(session.user, {
        name: newName,
        username: newUsername,
        pin: newPin,
        roleId: newRoleId,
      });
      setNewName('');
      setNewUsername('');
      setNewPin('');
      setFeedback({type: 'success', text: 'تمت إضافة المستخدم وتشفير رمز PIN بنجاح.'});
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إضافة المستخدم.',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (target: UserWithRole) => {
    if (!session) return;
    setFeedback(null);
    try {
      await authRepository.updateUserRoleAndStatus(session.user, target.id, {
        isActive: !target.isActive,
      });
      setFeedback({
        type: 'success',
        text: target.isActive ? `تم تعطيل حساب ${target.name}.` : `تم تفعيل حساب ${target.name}.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث الحالة.',
      });
    }
  };

  const handleChangeRole = async (target: UserWithRole, roleId: string) => {
    if (!session) return;
    setFeedback(null);
    try {
      await authRepository.updateUserRoleAndStatus(session.user, target.id, {roleId});
      if (target.id === session.user.id) {
        await refreshSession();
      }
      setFeedback({type: 'success', text: `تم تحديث دور ${target.name}.`});
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث الدور.',
      });
    }
  };

  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !pinTarget) return;
    setFeedback(null);
    try {
      await authRepository.resetUserPin(session.user, pinTarget.id, resetPinValue);
      setFeedback({type: 'success', text: `تم تحديث رمز PIN للمستخدم ${pinTarget.name}.`});
      setPinTarget(null);
      setResetPinValue('');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تغيير رمز PIN.',
      });
    }
  };

  const handleToggleRolePermission = async (role: RoleRecord, perm: PermissionKey) => {
    if (!session) return;
    setFeedback(null);
    const has = role.permissions.includes(perm);
    const next = has
      ? role.permissions.filter((p) => p !== perm)
      : [...role.permissions, perm];

    try {
      await authRepository.updateRolePermissions(session.user, role.id, next);
      if (role.id === session.role.id) {
        await refreshSession();
      }
      setFeedback({type: 'success', text: `تم تحديث صلاحيات دور (${role.nameAr}).`});
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث الصلاحية.',
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Interactive Tab Bar */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl w-fit overflow-x-auto max-w-full">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`min-h-[40px] px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'users'
              ? 'bg-[#0B1F3A] text-white'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          المستخدمون ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('roles')}
          className={`min-h-[40px] px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'roles'
              ? 'bg-[#0B1F3A] text-white'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          مصفوفة الصلاحيات ({roles.length} أدوار)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'audit'
              ? 'bg-[#0B1F3A] text-white'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4 text-[#C9A227]" />
          <span>سجل المراجعة</span>
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'success' && <Check className="w-4 h-4 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {activeTab === 'users' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Add User Form */}
          <section className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="w-5 h-5 text-[#C9A227]" />
              <h2 className="text-base font-bold text-[#0B1F3A]">إضافة مستخدم جديد</h2>
            </div>

            <form onSubmit={(e) => void handleCreateUser(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الاسم الكامل
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: كريم السيد"
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3 text-sm focus:border-[#0B1F3A] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم الدخول
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="kareem"
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3 text-sm text-left focus:border-[#0B1F3A] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الدور الوظيفي
                  </label>
                  <select
                    value={newRoleId}
                    onChange={(e) => setNewRoleId(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3 text-sm bg-white focus:border-[#0B1F3A] focus:outline-none"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    رمز PIN (4–8 أرقام)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4,8}"
                    maxLength={8}
                    required
                    dir="ltr"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3 text-center text-base font-bold tracking-widest tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full min-h-[48px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] transition-colors disabled:opacity-60 cursor-pointer"
              >
                {creating ? 'جارٍ الحفظ...' : 'إضافة المستخدم'}
              </button>
            </form>
          </section>

          {/* Users List */}
          <section className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5">
            <h2 className="text-base font-bold text-[#0B1F3A] mb-4">حسابات المستخدمين</h2>
            {loading ? (
              <p className="text-sm text-slate-500">جارٍ التحميل...</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {users.map((u) => (
                  <li key={u.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{u.name}</span>
                        <span className="text-xs text-slate-500" dir="ltr">
                          @{u.username}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-2">
                        <span>{u.isActive ? 'نشط' : 'معطّل'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {u.lastLoginAt
                            ? `آخر دخول: ${formatArabicDateTime(u.lastLoginAt)}`
                            : 'لم يسجل دخول بعد'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`دور ${u.name}`}
                        value={u.roleId}
                        onChange={(e) => void handleChangeRole(u, e.target.value)}
                        className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.nameAr}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          setPinTarget(u);
                          setResetPinValue('');
                        }}
                        className="min-h-[40px] inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>تغيير PIN</span>
                      </button>

                      {u.id !== session?.user.id && (
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(u)}
                          className={`min-h-[40px] rounded-xl px-3 text-xs font-semibold cursor-pointer ${
                            u.isActive
                              ? 'border border-red-200 text-red-700 hover:bg-red-50'
                              : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {u.isActive ? 'تعطيل' : 'تفعيل'}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : activeTab === 'roles' ? (
        /* Role Permissions Matrix */
        <section className="rounded-2xl bg-white border border-slate-200 p-5 overflow-x-auto">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-[#C9A227]" />
            <div>
              <h2 className="text-base font-bold text-[#0B1F3A]">مصفوفة الصلاحيات حسب الدور</h2>
              <p className="text-xs text-slate-500">
                يؤثر تعديل الصلاحيات فوراً على الأزرار والشاشات المتاحة لكل دور.
              </p>
            </div>
          </div>

          <table className="w-full min-w-[680px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-right">
                <th className="py-3 px-3 font-bold text-[#0B1F3A]">الصلاحية</th>
                {roles.map((r) => (
                  <th key={r.id} className="py-3 px-3 text-center font-bold text-[#0B1F3A]">
                    {r.nameAr}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PERMISSION_DEFINITIONS.map((perm) => (
                <tr key={perm.key} className="hover:bg-slate-50">
                  <td className="py-3 px-3">
                    <div className="font-semibold text-slate-900">{perm.labelAr}</div>
                    <div className="text-xs text-slate-500">{perm.descriptionAr}</div>
                  </td>
                  {roles.map((role) => {
                    const checked = role.permissions.includes(perm.key);
                    const lockedAdminPerm =
                      role.code === 'admin' && perm.key === 'users.manage';
                    return (
                      <td key={role.id} className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${perm.labelAr} - ${role.nameAr}`}
                          checked={checked}
                          disabled={lockedAdminPerm}
                          onChange={() => void handleToggleRolePermission(role, perm.key)}
                          className="h-5 w-5 accent-[#0B1F3A] cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        /* Audit Log Viewer */
        <div className="space-y-4">
          <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-[#C9A227]" />
                <div>
                  <h2 className="text-base font-bold text-[#0B1F3A]">سجل المراجعة والتدقيق</h2>
                  <p className="text-xs text-slate-500">
                    سجل غير قابل للتعديل يوثق جميع العمليات الحساسة والتعديلات قبل وبعد.
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-slate-600 tabular-nums">
                {auditEntries.length} سجل
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="بحث في البيان أو المستخدم أو التفاصيل..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 pr-9 pl-3 text-sm"
                />
              </div>

              <select
                aria-label="تصفية حسب المستخدم"
                value={auditActorId}
                onChange={(e) => setAuditActorId(e.target.value)}
                className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold"
              >
                <option value="all">كل المستخدمين</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="تصفية حسب نوع العملية"
                value={auditAction}
                onChange={(e) => setAuditAction(e.target.value as AuditAction | 'all')}
                className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold"
              >
                <option value="all">كل الإجراءات</option>
                {Object.entries(AUDIT_ACTION_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                aria-label="تصفية حسب السجل"
                value={auditEntity}
                onChange={(e) => setAuditEntity(e.target.value)}
                className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold"
              >
                <option value="all">كل الجداول</option>
                {Object.entries(ENTITY_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="من تاريخ"
                  value={auditDateFrom}
                  onChange={(e) => setAuditDateFrom(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-2 text-xs"
                />
                <input
                  type="date"
                  aria-label="إلى تاريخ"
                  value={auditDateTo}
                  onChange={(e) => setAuditDateTo(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-2 text-xs"
                />
              </div>
            </div>
          </section>

          <section className="space-y-2.5">
            {auditLoading ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
                جارٍ تحميل سجل المراجعة...
              </div>
            ) : auditEntries.length === 0 ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
                لا توجد سجلات مطابقة لمعايير البحث الحالية.
              </div>
            ) : (
              auditEntries.map((entry) => {
                const {record, actionLabelAr, entityLabelAr, details} = entry;
                const beforeObj = details.before ?? null;
                const afterObj = details.after ?? null;
                const diffKeys = Array.from(
                  new Set([
                    ...Object.keys(beforeObj ?? {}),
                    ...Object.keys(afterObj ?? {}),
                  ])
                );
                const extraEntries = Object.entries(details).filter(
                  ([k]) => k !== 'before' && k !== 'after'
                );

                return (
                  <article
                    key={record.id}
                    className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-[#0B1F3A] bg-[#FAF3DC] border border-[#C9A227]/40 px-2 py-0.5 rounded-lg">
                          {actionLabelAr}
                        </span>
                        <span className="font-semibold text-slate-700">{entityLabelAr}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-bold text-slate-900">{record.actorName}</span>
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {formatArabicDateTime(record.createdAt)}
                      </span>
                    </div>

                    <p className="text-sm font-semibold text-slate-900">{record.summary}</p>

                    {diffKeys.length > 0 && (
                      <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
                        <table className="w-full border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200 text-right text-slate-500">
                            <tr>
                              <th className="py-1.5 px-2.5">الحقل</th>
                              <th className="py-1.5 px-2.5">قبل التعديل</th>
                              <th className="py-1.5 px-2.5">بعد التعديل</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {diffKeys.map((key) => {
                              const prevVal = formatDiffValue(beforeObj?.[key]);
                              const nextVal = formatDiffValue(afterObj?.[key]);
                              const changed = prevVal !== nextVal;
                              return (
                                <tr key={key} className={changed ? 'bg-amber-50/40' : ''}>
                                  <td className="py-1.5 px-2.5 font-semibold text-slate-700">
                                    {AUDIT_FIELD_LABELS[key] ?? key}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-red-700 tabular-nums">
                                    {prevVal}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-emerald-700 font-bold tabular-nums">
                                    {nextVal}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {extraEntries.length > 0 && (
                      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                        {extraEntries.map(([k, v]) => (
                          <span
                            key={k}
                            className="bg-slate-100 rounded-md px-2 py-0.5 font-mono"
                            dir="ltr"
                          >
                            {k}: {formatDiffValue(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}

      {/* Reset PIN Modal */}
      {pinTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <form
            onSubmit={(e) => void handleResetPinSubmit(e)}
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4"
          >
            <h3 className="text-base font-bold text-[#0B1F3A]">
              تعيين رمز PIN جديد لـ {pinTarget.name}
            </h3>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              maxLength={8}
              required
              autoFocus
              dir="ltr"
              value={resetPinValue}
              onChange={(e) => setResetPinValue(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3 text-center text-lg font-bold tracking-widest tabular-nums focus:border-[#0B1F3A] focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 min-h-[44px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                حفظ الرمز
              </button>
              <button
                type="button"
                onClick={() => setPinTarget(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

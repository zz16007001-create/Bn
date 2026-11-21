import {CURRENT_DB_VERSION, db} from '../db/database';
import {resetMigrationState, runDatabaseMigrations} from '../db/migrations';
import type {UserRecord} from '../types/domain';
import {sha256Hex} from '../utils/crypto';
import {appendAuditLog, requirePermission, withReadTx, withWriteTx} from './baseRepository';

export const LAST_BACKUP_STORAGE_KEY = 'nukhbat_last_backup_at';

export interface BackupPayload {
  app: 'nukhbat-albonn-pwa';
  formatVersion: 2;
  schemaVersion: number;
  exportedAt: number;
  exportedBy: string;
  checksumAlgorithm: 'SHA-256';
  checksum: string;
  tables: Record<string, unknown[]>;
}

export interface TableRowCount {
  tableName: string;
  count: number;
}

export interface VerifiedBackupPreview {
  payload: BackupPayload;
  totalRecords: number;
  checksumValid: boolean;
  wasCompressed: boolean;
}

export async function computeTablesChecksum(
  tables: Record<string, unknown[]>
): Promise<string> {
  const ordered: Record<string, unknown[]> = {};
  for (const key of Object.keys(tables).sort()) {
    ordered[key] = Array.isArray(tables[key]) ? tables[key] : [];
  }
  return sha256Hex(JSON.stringify(ordered));
}

export function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function supportsGzipStreams(): boolean {
  return (
    typeof CompressionStream !== 'undefined' &&
    typeof DecompressionStream !== 'undefined'
  );
}

export async function compressTextToGzip(text: string): Promise<Uint8Array> {
  if (!supportsGzipStreams()) {
    throw new Error('المتصفح لا يدعم ضغط Gzip المباشر.');
  }
  const inputStream = new Blob([text]).stream();
  const compressedStream = inputStream.pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(compressedStream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function decompressGzipToText(bytes: Uint8Array): Promise<string> {
  if (!supportsGzipStreams()) {
    throw new Error('المتصفح الحالي لا يدعم فك ضغط ملفات .gz؛ يرجى استخدام ملف JSON.');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const inputStream = new Blob([copy]).stream();
  const decompressedStream = inputStream.pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressedStream).text();
}

export async function decodeAndVerifyBackup(
  rawInput: string | ArrayBuffer | Uint8Array
): Promise<VerifiedBackupPreview> {
  let text: string;
  let wasCompressed = false;

  if (typeof rawInput === 'string') {
    text = rawInput;
  } else {
    const bytes = rawInput instanceof Uint8Array ? rawInput : new Uint8Array(rawInput);
    if (isGzipBytes(bytes)) {
      wasCompressed = true;
      text = await decompressGzipToText(bytes);
    } else {
      text = new TextDecoder().decode(bytes);
    }
  }

  let parsed: BackupPayload;
  try {
    parsed = JSON.parse(text) as BackupPayload;
  } catch {
    throw new Error('ملف النسخة الاحتياطية غير صالح أو تالف (تنسيق JSON غير صحيح).');
  }

  if (
    !parsed ||
    parsed.app !== 'nukhbat-albonn-pwa' ||
    typeof parsed.schemaVersion !== 'number' ||
    !parsed.tables ||
    typeof parsed.tables !== 'object'
  ) {
    throw new Error('ملف النسخة الاحتياطية لا يطابق بنية نظام نُخبة البن.');
  }

  if (parsed.schemaVersion < 1 || parsed.schemaVersion > CURRENT_DB_VERSION) {
    throw new Error(
      `إصدار قاعدة البيانات في النسخة (${parsed.schemaVersion}) غير متوافق مع الإصدار الحالي (${CURRENT_DB_VERSION}).`
    );
  }

  const expectedChecksum = await computeTablesChecksum(parsed.tables);
  if (parsed.formatVersion === 2 || typeof parsed.checksum === 'string') {
    if (!parsed.checksum || parsed.checksum !== expectedChecksum) {
      throw new Error(
        'فشل التحقق من سلامة الملف (SHA-256 Checksum غير مطابق — الملف تالف أو تم تعديله).'
      );
    }
  }

  const totalRecords = Object.values(parsed.tables).reduce(
    (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
    0
  );

  return {
    payload: {
      ...parsed,
      formatVersion: 2,
      checksumAlgorithm: 'SHA-256',
      checksum: parsed.checksum || expectedChecksum,
    },
    totalRecords,
    checksumValid: true,
    wasCompressed,
  };
}

export function getStoredLastBackupAt(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LAST_BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function persistLastBackupAtLocal(ts: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_BACKUP_STORAGE_KEY, String(ts));
    }
  } catch {
    // ignore
  }
}

export const backupRepository = {
  async getTableRowCounts(): Promise<TableRowCount[]> {
    await runDatabaseMigrations();
    return withReadTx(db.tables, async () => {
      const results = await Promise.all(
        db.tables.map(async (table) => ({
          tableName: table.name,
          count: await table.count(),
        }))
      );
      return results;
    });
  },

  async exportFullBackup(actor: UserRecord): Promise<BackupPayload> {
    await runDatabaseMigrations();
    const exportedAt = Date.now();
    const payloadCore = await withWriteTx(db.tables, async () => {
      await requirePermission(
        actor,
        'backup.manage',
        'ليس لديك صلاحية تصدير النسخ الاحتياطية.'
      );

      const currentSettings = await db.company_settings.get('default');
      if (currentSettings) {
        await db.company_settings.update('default', {
          lastBackupAt: exportedAt,
          updatedAt: exportedAt,
        });
      }

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'backup_export',
        entityType: 'system',
        entityId: 'full_backup',
        summary: `تصدير نسخة احتياطية كاملة بواسطة ${actor.name}`,
        details: {schemaVersion: CURRENT_DB_VERSION, exportedAt},
      });

      const tables: Record<string, unknown[]> = {};
      for (const table of db.tables) {
        tables[table.name] = await table.toArray();
      }
      return tables;
    });

    const checksum = await computeTablesChecksum(payloadCore);
    persistLastBackupAtLocal(exportedAt);

    return {
      app: 'nukhbat-albonn-pwa',
      formatVersion: 2,
      schemaVersion: CURRENT_DB_VERSION,
      exportedAt,
      exportedBy: actor.name,
      checksumAlgorithm: 'SHA-256',
      checksum,
      tables: payloadCore,
    };
  },

  async exportCompressedBackup(actor: UserRecord): Promise<{
    payload: BackupPayload;
    bytes: Uint8Array;
    compressed: boolean;
  }> {
    const payload = await this.exportFullBackup(actor);
    const json = JSON.stringify(payload);
    if (supportsGzipStreams()) {
      const gz = await compressTextToGzip(json);
      return {payload, bytes: gz, compressed: true};
    }
    return {
      payload,
      bytes: new TextEncoder().encode(json),
      compressed: false,
    };
  },

  async restoreFullBackup(
    actor: UserRecord,
    rawInput: string | ArrayBuffer | Uint8Array
  ): Promise<VerifiedBackupPreview> {
    await runDatabaseMigrations();

    // Enforce permission BEFORE touching DB
    await withReadTx([db.roles], async () => {
      await requirePermission(
        actor,
        'backup.manage',
        'ليس لديك صلاحية استعادة النسخ الاحتياطية.'
      );
    });

    // Verify format, schema compatibility & SHA-256 checksum BEFORE clearing DB
    const verified = await decodeAndVerifyBackup(rawInput);
    const parsed = verified.payload;

    await withWriteTx(db.tables, async () => {
      for (const table of db.tables) {
        await table.clear();
        const rows = parsed.tables[table.name];
        if (Array.isArray(rows) && rows.length > 0) {
          await table.bulkAdd(rows);
        }
      }

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'backup_import',
        entityType: 'system',
        entityId: 'full_backup',
        summary: `استعادة نسخة احتياطية كاملة (إصدار القاعدة v${parsed.schemaVersion})`,
        details: {
          exportedAt: parsed.exportedAt,
          exportedBy: parsed.exportedBy,
          checksum: parsed.checksum,
          wasCompressed: verified.wasCompressed,
          totalRecords: verified.totalRecords,
        },
      });
    });

    // If restored from an older schema version, run pending migrations cleanly
    if (parsed.schemaVersion < CURRENT_DB_VERSION) {
      resetMigrationState();
      await runDatabaseMigrations();
    }

    const now = Date.now();
    await withWriteTx([db.company_settings], async () => {
      const s = await db.company_settings.get('default');
      if (s) {
        await db.company_settings.update('default', {
          lastBackupAt: parsed.exportedAt || now,
          updatedAt: now,
        });
      }
    });
    persistLastBackupAtLocal(parsed.exportedAt || now);

    return verified;
  },
};

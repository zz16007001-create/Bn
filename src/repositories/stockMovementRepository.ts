import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {StockMovementRecord, StockMovementType, UserRecord, UUID} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';

export interface EnrichedStockMovement {
  movement: StockMovementRecord;
  itemName: string;
  itemSku: string;
  warehouseName: string;
  actorName: string;
}

export interface StockMovementFilter {
  itemId?: UUID;
  warehouseId?: UUID;
  movementType?: StockMovementType | 'all';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  opening: 'رصيد افتتاحي',
  purchase_in: 'شراء',
  sale_out: 'بيع',
  return_in: 'مرتجع بيع',
  return_out: 'مرتجع شراء',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  adjustment: 'تسوية',
  shortage: 'عجز',
  surplus: 'زيادة',
  reversal: 'قيد عكسي',
};

export const stockMovementRepository = {
  async listMovements(filter?: StockMovementFilter): Promise<EnrichedStockMovement[]> {
    await runDatabaseMigrations();
    return withReadTx([db.stock_movements, db.items, db.warehouses, db.users], async () => {
      const [movements, items, warehouses, users] = await Promise.all([
        db.stock_movements.orderBy('createdAt').reverse().toArray(),
        db.items.toArray(),
        db.warehouses.toArray(),
        db.users.toArray(),
      ]);

      const itemMap = new Map(items.map((i) => [i.id, i]));
      const whMap = new Map(warehouses.map((w) => [w.id, w]));
      const userMap = new Map(users.map((u) => [u.id, u]));

      const fromMs = filter?.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : null;
      const toMs = filter?.dateTo ? new Date(`${filter.dateTo}T23:59:59.999`).getTime() : null;
      const searchLower = filter?.search?.trim().toLowerCase() ?? '';

      return movements
        .filter((m) => {
          if (filter?.itemId && m.itemId !== filter.itemId) return false;
          if (filter?.warehouseId && m.warehouseId !== filter.warehouseId) return false;
          if (
            filter?.movementType &&
            filter.movementType !== 'all' &&
            m.movementType !== filter.movementType
          ) {
            return false;
          }
          if (fromMs !== null && m.createdAt < fromMs) return false;
          if (toMs !== null && m.createdAt > toMs) return false;

          if (searchLower) {
            const item = itemMap.get(m.itemId);
            const matchItem =
              item?.name.toLowerCase().includes(searchLower) ||
              item?.sku.toLowerCase().includes(searchLower);
            const matchNotes = m.notes.toLowerCase().includes(searchLower);
            const matchRef = m.referenceId.toLowerCase().includes(searchLower);
            if (!matchItem && !matchNotes && !matchRef) return false;
          }
          return true;
        })
        .map((movement) => {
          const item = itemMap.get(movement.itemId);
          const wh = whMap.get(movement.warehouseId);
          const actor = userMap.get(movement.createdBy);
          return {
            movement,
            itemName: item?.name ?? 'صنف غير معروف',
            itemSku: item?.sku ?? '-',
            warehouseName: wh?.name ?? 'مخزن غير معروف',
            actorName: actor?.name ?? 'النظام',
          };
        });
    });
  },

  async recordInventoryAdjustment(
    actor: UserRecord,
    input: {
      warehouseId: UUID;
      notes?: string;
      mode?: 'count' | 'adjustment';
      entries: Array<{itemId: UUID; actualQty: number}>;
    }
  ): Promise<{adjustedCount: number}> {
    await runDatabaseMigrations();
    if (!input.entries.length) {
      throw new Error('يرجى تحديد صنف واحد على الأقل للتسوية.');
    }

    return withWriteTx([db.warehouses, db.items, db.stock_movements, db.audit_log], async () => {
      const wh = await db.warehouses.get(input.warehouseId);
      if (!wh) throw new Error('المخزن غير موجود.');

      const now = Date.now();
      const batchId = generateUUID();
      const newMovements: StockMovementRecord[] = [];

      for (const entry of input.entries) {
        const actual = Math.round(entry.actualQty);
        if (!Number.isFinite(actual) || actual < 0) {
          throw new Error('الكمية الفعلية لا يمكن أن تكون سالبة.');
        }

        const item = await db.items.get(entry.itemId);
        if (!item) continue;

        const existingMovements = await db.stock_movements
          .where('[itemId+warehouseId]')
          .equals([entry.itemId, input.warehouseId])
          .toArray();
        const bookQty = existingMovements.reduce((sum, m) => sum + m.quantityDelta, 0);
        const diff = actual - bookQty;

        if (diff === 0) continue;

        const movementType: StockMovementType =
          input.mode === 'adjustment'
            ? 'adjustment'
            : diff > 0
            ? 'surplus'
            : 'shortage';

        newMovements.push({
          id: generateUUID(),
          itemId: entry.itemId,
          warehouseId: input.warehouseId,
          movementType,
          quantityDelta: diff,
          unitCostPiastres: item.costPricePiastres,
          referenceType: 'stock_count',
          referenceId: batchId,
          notes:
            (input.notes ?? '').trim() ||
            `جرد مخزني (${wh.name}): دفتري ${bookQty} ← فعلي ${actual}`,
          reversesId: null,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        });
      }

      if (newMovements.length === 0) {
        return {adjustedCount: 0};
      }

      await db.stock_movements.bulkAdd(newMovements);
      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'stock_movements',
        entityId: batchId,
        summary: `تسوية جرد لمخزن (${wh.name}) - عدد الأصناف المعدلة: ${newMovements.length}`,
      });

      return {adjustedCount: newMovements.length};
    });
  },
};

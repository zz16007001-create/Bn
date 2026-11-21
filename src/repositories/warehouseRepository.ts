import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {ItemRecord, StockMovementRecord, UserRecord, UUID, WarehouseRecord} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {appendAuditLog, requirePermission, withReadTx, withWriteTx} from './baseRepository';

export interface WarehouseWithStats {
  warehouse: WarehouseRecord;
  distinctItemsCount: number;
  totalPiecesCount: number;
  totalStockValuePiastres: number;
}

export interface ItemWarehouseBalance {
  item: ItemRecord;
  warehouseId: UUID;
  warehouseName: string;
  quantity: number;
  valuePiastres: number;
}

export const warehouseRepository = {
  async listWarehouses(): Promise<WarehouseWithStats[]> {
    await runDatabaseMigrations();
    return withReadTx([db.warehouses, db.stock_movements, db.items], async () => {
      const [warehouses, movements, items] = await Promise.all([
        db.warehouses.toArray(),
        db.stock_movements.toArray(),
        db.items.toArray(),
      ]);

      const itemCostMap = new Map(items.map((i) => [i.id, i.costPricePiastres]));
      const qtyByWhItem = new Map<string, number>();

      for (const m of movements) {
        const key = `${m.warehouseId}::${m.itemId}`;
        qtyByWhItem.set(key, (qtyByWhItem.get(key) ?? 0) + m.quantityDelta);
      }

      return warehouses
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt - b.createdAt)
        .map((wh) => {
          let distinctItemsCount = 0;
          let totalPiecesCount = 0;
          let totalStockValuePiastres = 0;

          for (const [key, qty] of qtyByWhItem.entries()) {
            if (!key.startsWith(`${wh.id}::`)) continue;
            const itemId = key.split('::')[1];
            if (qty !== 0) distinctItemsCount += 1;
            totalPiecesCount += qty;
            totalStockValuePiastres += qty * (itemCostMap.get(itemId) ?? 0);
          }

          return {
            warehouse: wh,
            distinctItemsCount,
            totalPiecesCount,
            totalStockValuePiastres,
          };
        });
    });
  },

  async getBalancesForWarehouse(warehouseId?: UUID): Promise<ItemWarehouseBalance[]> {
    await runDatabaseMigrations();
    return withReadTx([db.warehouses, db.items, db.stock_movements], async () => {
      const [warehouses, items, movements] = await Promise.all([
        db.warehouses.toArray(),
        db.items.toArray(),
        db.stock_movements.toArray(),
      ]);

      const whMap = new Map(warehouses.map((w) => [w.id, w]));
      const itemMap = new Map(items.map((i) => [i.id, i]));
      const qtyMap = new Map<string, number>();

      for (const m of movements) {
        if (warehouseId && m.warehouseId !== warehouseId) continue;
        const key = `${m.warehouseId}::${m.itemId}`;
        qtyMap.set(key, (qtyMap.get(key) ?? 0) + m.quantityDelta);
      }

      const result: ItemWarehouseBalance[] = [];
      for (const [key, quantity] of qtyMap.entries()) {
        const [whId, itemId] = key.split('::');
        const item = itemMap.get(itemId);
        const wh = whMap.get(whId);
        if (!item || !wh) continue;
        result.push({
          item,
          warehouseId: whId,
          warehouseName: wh.name,
          quantity,
          valuePiastres: quantity * item.costPricePiastres,
        });
      }

      // Include zero-balance active items when filtering a specific warehouse
      if (warehouseId && whMap.has(warehouseId)) {
        const wh = whMap.get(warehouseId)!;
        const presentItemIds = new Set(result.map((r) => r.item.id));
        for (const item of items) {
          if (!presentItemIds.has(item.id)) {
            result.push({
              item,
              warehouseId,
              warehouseName: wh.name,
              quantity: 0,
              valuePiastres: 0,
            });
          }
        }
      }

      return result.sort((a, b) => a.item.name.localeCompare(b.item.name, 'ar'));
    });
  },

  async createWarehouse(
    actor: UserRecord,
    input: {code: string; name: string; location?: string; isDefault?: boolean}
  ): Promise<WarehouseRecord> {
    await runDatabaseMigrations();
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    const location = (input.location ?? '').trim();

    if (!code || name.length < 2) {
      throw new Error('يرجى إدخال كود واسم المخزن.');
    }

    return withWriteTx([db.warehouses, db.audit_log], async () => {
      const dup = await db.warehouses.where('code').equals(code).first();
      if (dup) throw new Error(`كود المخزن (${code}) مسجل مسبقاً.`);

      const now = Date.now();
      if (input.isDefault) {
        await db.warehouses.toCollection().modify({isDefault: false, updatedAt: now});
      }

      const wh: WarehouseRecord = {
        id: generateUUID(),
        code,
        name,
        location,
        isDefault: Boolean(input.isDefault),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      };
      await db.warehouses.add(wh);

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'warehouses',
        entityId: wh.id,
        summary: `إضافة مخزن جديد: ${wh.name} (${wh.code})`,
      });

      return wh;
    });
  },

  async updateWarehouse(
    actor: UserRecord,
    warehouseId: UUID,
    patch: {name?: string; location?: string; isDefault?: boolean; isActive?: boolean}
  ): Promise<void> {
    await runDatabaseMigrations();
    await withWriteTx([db.warehouses, db.audit_log], async () => {
      const existing = await db.warehouses.get(warehouseId);
      if (!existing) throw new Error('المخزن غير موجود.');

      const now = Date.now();
      if (patch.isDefault) {
        await db.warehouses.toCollection().modify({isDefault: false, updatedAt: now});
      }
      if (existing.isDefault && patch.isActive === false) {
        throw new Error('لا يمكن تعطيل المخزن الافتراضي الرئيسي.');
      }

      const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
      const nextLocation = patch.location !== undefined ? patch.location.trim() : existing.location;
      const nextDefault = patch.isDefault !== undefined ? patch.isDefault : existing.isDefault;
      const nextActive = patch.isActive !== undefined ? patch.isActive : existing.isActive;

      await db.warehouses.update(warehouseId, {
        ...(patch.name !== undefined ? {name: nextName} : {}),
        ...(patch.location !== undefined ? {location: nextLocation} : {}),
        ...(patch.isDefault !== undefined ? {isDefault: nextDefault} : {}),
        ...(patch.isActive !== undefined ? {isActive: nextActive} : {}),
        updatedAt: now,
      });

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'warehouses',
        entityId: warehouseId,
        summary: `تحديث بيانات المخزن: ${nextName}`,
        before: {
          name: existing.name,
          location: existing.location,
          isDefault: existing.isDefault,
          isActive: existing.isActive,
        },
        after: {
          name: nextName,
          location: nextLocation,
          isDefault: nextDefault,
          isActive: nextActive,
        },
      });
    });
  },

  async transferBetweenWarehouses(
    actor: UserRecord,
    input: {
      itemId: UUID;
      fromWarehouseId: UUID;
      toWarehouseId: UUID;
      quantityBasePieces: number;
      notes?: string;
      allowStockOverride?: boolean;
    }
  ): Promise<void> {
    await runDatabaseMigrations();
    const qty = Math.round(input.quantityBasePieces);
    if (qty <= 0) {
      throw new Error('كمية التحويل يجب أن تكون أكبر من صفر.');
    }
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new Error('لا يمكن التحويل إلى نفس المخزن.');
    }

    await withWriteTx(
      [db.roles, db.warehouses, db.items, db.stock_movements, db.audit_log],
      async () => {
      const [fromWh, toWh, item] = await Promise.all([
        db.warehouses.get(input.fromWarehouseId),
        db.warehouses.get(input.toWarehouseId),
        db.items.get(input.itemId),
      ]);
      if (!fromWh || !toWh) throw new Error('يرجى التأكد من المخزنين المحددين.');
      if (!item) throw new Error('الصنف غير موجود.');

      const srcMovements = await db.stock_movements
        .where('[itemId+warehouseId]')
        .equals([item.id, fromWh.id])
        .toArray();
      const available = srcMovements.reduce((sum, m) => sum + m.quantityDelta, 0);

      if (available < qty) {
        if (!input.allowStockOverride) {
          throw new Error(
            `الرصيد المتاح في ${fromWh.name} هو ${available} قطعة فقط (مطلوب ${qty}).`
          );
        }
        await requirePermission(
          actor,
          'stock.override',
          'ليس لديك صلاحية تجاوز رصيد المخزون عند التحويل.'
        );
      }

      const now = Date.now();
      const transferRefId = generateUUID();
      const notes = (input.notes ?? '').trim() || `تحويل من ${fromWh.name} إلى ${toWh.name}`;

      const outMove: StockMovementRecord = {
        id: generateUUID(),
        itemId: item.id,
        warehouseId: fromWh.id,
        movementType: 'transfer_out',
        quantityDelta: -qty,
        unitCostPiastres: item.costPricePiastres,
        referenceType: 'warehouse_transfer',
        referenceId: transferRefId,
        notes,
        reversesId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      };

      const inMove: StockMovementRecord = {
        id: generateUUID(),
        itemId: item.id,
        warehouseId: toWh.id,
        movementType: 'transfer_in',
        quantityDelta: qty,
        unitCostPiastres: item.costPricePiastres,
        referenceType: 'warehouse_transfer',
        referenceId: transferRefId,
        notes,
        reversesId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      };

      await db.stock_movements.bulkAdd([outMove, inMove]);

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'stock_movements',
        entityId: transferRefId,
        summary: `تحويل ${qty} قطعة من (${item.name}) من ${fromWh.name} إلى ${toWh.name}`,
      });
    });
  },
};

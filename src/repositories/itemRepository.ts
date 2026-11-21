import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  ItemRecord,
  StockMovementRecord,
  UnitPackagingRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';

export interface ItemWithDetails {
  item: ItemRecord;
  baseUnit: UnitPackagingRecord;
  cartonUnit: UnitPackagingRecord | null;
  allUnits: UnitPackagingRecord[];
  totalStockQty: number;
  hasMovements: boolean;
}

export interface CreateOrUpdateItemInput {
  name: string;
  sku: string;
  barcode?: string;
  category?: string;
  costPricePiastres: number;
  pieceSalePricePiastres: number;
  cartonSalePricePiastres: number;
  cartonConversionFactor: number;
  minStockQty: number;
  imageDataUrl?: string | null;
  isActive?: boolean;
  openingStockQty?: number;
  openingWarehouseId?: UUID;
}

export interface ExcelItemImportRow {
  sku: string;
  name: string;
  barcode?: string;
  category?: string;
  costPricePiastres: number;
  pieceSalePricePiastres: number;
  cartonSalePricePiastres: number;
  cartonConversionFactor: number;
  minStockQty: number;
  openingStockQty?: number;
}

export interface ExcelImportResult {
  importedCount: number;
  skippedCount: number;
  errors: string[];
}

export const itemRepository = {
  async listItems(filter?: {
    search?: string;
    category?: string;
    status?: 'all' | 'active' | 'inactive' | 'low_stock';
  }): Promise<ItemWithDetails[]> {
    await runDatabaseMigrations();
    return withReadTx([db.items, db.units, db.stock_movements], async () => {
      const [items, units, movements] = await Promise.all([
        db.items.toArray(),
        db.units.toArray(),
        db.stock_movements.toArray(),
      ]);

      const unitsByItem = new Map<UUID, UnitPackagingRecord[]>();
      for (const u of units) {
        const list = unitsByItem.get(u.itemId) ?? [];
        list.push(u);
        unitsByItem.set(u.itemId, list);
      }

      const stockByItem = new Map<UUID, number>();
      const movementsCountByItem = new Map<UUID, number>();
      for (const m of movements) {
        stockByItem.set(m.itemId, (stockByItem.get(m.itemId) ?? 0) + m.quantityDelta);
        movementsCountByItem.set(m.itemId, (movementsCountByItem.get(m.itemId) ?? 0) + 1);
      }

      const searchLower = filter?.search?.trim().toLowerCase() ?? '';
      const categoryFilter = filter?.category?.trim() ?? '';
      const statusFilter = filter?.status ?? 'all';

      const mapped: ItemWithDetails[] = items
        .map((item) => {
          const itemUnits = unitsByItem.get(item.id) ?? [];
          const baseUnit =
            itemUnits.find((u) => u.isBase) ??
            ({
              id: item.baseUnitId,
              itemId: item.id,
              name: 'قطعة',
              conversionFactor: 1,
              barcode: item.barcode,
              salePricePiastres: item.retailPricePiastres,
              isBase: true,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              createdBy: item.createdBy,
            } satisfies UnitPackagingRecord);
          const cartonUnit = itemUnits.find((u) => !u.isBase) ?? null;
          const totalStockQty = stockByItem.get(item.id) ?? 0;
          const hasMovements = (movementsCountByItem.get(item.id) ?? 0) > 0;
          return {
            item,
            baseUnit,
            cartonUnit,
            allUnits: itemUnits,
            totalStockQty,
            hasMovements,
          };
        })
        .filter((entry) => {
          if (searchLower) {
            const matchName = entry.item.name.toLowerCase().includes(searchLower);
            const matchSku = entry.item.sku.toLowerCase().includes(searchLower);
            const matchBarcode = entry.item.barcode.toLowerCase().includes(searchLower);
            if (!matchName && !matchSku && !matchBarcode) return false;
          }
          if (categoryFilter && entry.item.category !== categoryFilter) {
            return false;
          }
          if (statusFilter === 'active' && !entry.item.isActive) return false;
          if (statusFilter === 'inactive' && entry.item.isActive) return false;
          if (
            statusFilter === 'low_stock' &&
            entry.totalStockQty > entry.item.minStockQty
          ) {
            return false;
          }
          return true;
        })
        .sort((a, b) => a.item.name.localeCompare(b.item.name, 'ar'));

      return mapped;
    });
  },

  async createItem(
    actor: UserRecord,
    input: CreateOrUpdateItemInput
  ): Promise<ItemWithDetails> {
    await runDatabaseMigrations();
    const name = input.name.trim();
    const sku = input.sku.trim().toUpperCase();
    const barcode = (input.barcode ?? '').trim();
    const category = (input.category ?? 'بن').trim() || 'عام';
    const conversion = Math.round(input.cartonConversionFactor);

    if (name.length < 2) {
      throw new Error('اسم الصنف يجب أن لا يقل عن حرفين.');
    }
    if (!sku) {
      throw new Error('يرجى إدخال كود الصنف.');
    }
    if (!Number.isFinite(conversion) || conversion < 1) {
      throw new Error('عدد القطع في الكرتونة يجب أن يكون 1 على الأقل.');
    }

    const costPiastres = assertPiastres(input.costPricePiastres, 'سعر الشراء');
    const pieceSalePiastres = assertPiastres(input.pieceSalePricePiastres, 'سعر بيع القطعة');
    const cartonSalePiastres = assertPiastres(
      input.cartonSalePricePiastres,
      'سعر بيع الكرتونة'
    );
    const minStockQty = Math.max(0, Math.round(input.minStockQty || 0));
    const openingQty = Math.max(0, Math.round(input.openingStockQty || 0));

    return withWriteTx(
      [db.items, db.units, db.warehouses, db.stock_movements, db.audit_log],
      async () => {
        const existingSku = await db.items.where('sku').equals(sku).first();
        if (existingSku) {
          throw new Error(`كود الصنف (${sku}) مسجل مسبقاً.`);
        }

        const now = Date.now();
        const itemId = generateUUID();
        const baseUnitId = generateUUID();
        const cartonUnitId = generateUUID();

        const item: ItemRecord = {
          id: itemId,
          sku,
          barcode,
          name,
          category,
          baseUnitId,
          costPricePiastres: costPiastres,
          wholesalePricePiastres: cartonSalePiastres,
          retailPricePiastres: pieceSalePiastres,
          minStockQty,
          imageDataUrl: input.imageDataUrl ?? null,
          isActive: input.isActive ?? true,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };

        const baseUnit: UnitPackagingRecord = {
          id: baseUnitId,
          itemId,
          name: 'قطعة',
          conversionFactor: 1,
          barcode,
          salePricePiastres: pieceSalePiastres,
          isBase: true,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };

        const cartonUnit: UnitPackagingRecord = {
          id: cartonUnitId,
          itemId,
          name: 'كرتونة',
          conversionFactor: conversion,
          barcode: '',
          salePricePiastres: cartonSalePiastres,
          isBase: false,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };

        await db.items.add(item);
        await db.units.bulkAdd([baseUnit, cartonUnit]);

        if (openingQty > 0) {
          let warehouseId = input.openingWarehouseId;
          if (!warehouseId) {
            const defaultWh = await db.warehouses.filter((w) => w.isDefault).first();
            warehouseId = defaultWh?.id ?? (await db.warehouses.toCollection().first())?.id;
          }
          if (!warehouseId) {
            throw new Error('لا يوجد مخزن متاح لتسجيل الرصيد الافتتاحي.');
          }

          const openingMovement: StockMovementRecord = {
            id: generateUUID(),
            itemId,
            warehouseId,
            movementType: 'opening',
            quantityDelta: openingQty,
            unitCostPiastres: costPiastres,
            referenceType: 'opening_balance',
            referenceId: itemId,
            notes: `رصيد افتتاحي عند إضافة الصنف: ${name}`,
            reversesId: null,
            createdAt: now,
            updatedAt: now,
            createdBy: actor.id,
          };
          await db.stock_movements.add(openingMovement);
        }

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'items',
          entityId: item.id,
          summary: `إضافة صنف: ${item.name} (${item.sku}) - الكرتونة = ${conversion} قطعة`,
          details: {openingQty},
        });

        return {
          item,
          baseUnit,
          cartonUnit,
          allUnits: [baseUnit, cartonUnit],
          totalStockQty: openingQty,
          hasMovements: openingQty > 0,
        };
      }
    );
  },

  async updateItem(
    actor: UserRecord,
    itemId: UUID,
    input: CreateOrUpdateItemInput
  ): Promise<void> {
    await runDatabaseMigrations();
    const name = input.name.trim();
    const sku = input.sku.trim().toUpperCase();
    const barcode = (input.barcode ?? '').trim();
    const category = (input.category ?? 'بن').trim() || 'عام';
    const conversion = Math.round(input.cartonConversionFactor);

    if (name.length < 2) {
      throw new Error('اسم الصنف يجب أن لا يقل عن حرفين.');
    }
    if (!sku) {
      throw new Error('يرجى إدخال كود الصنف.');
    }
    if (!Number.isFinite(conversion) || conversion < 1) {
      throw new Error('عدد القطع في الكرتونة يجب أن يكون 1 على الأقل.');
    }

    const costPiastres = assertPiastres(input.costPricePiastres, 'سعر الشراء');
    const pieceSalePiastres = assertPiastres(input.pieceSalePricePiastres, 'سعر بيع القطعة');
    const cartonSalePiastres = assertPiastres(
      input.cartonSalePricePiastres,
      'سعر بيع الكرتونة'
    );
    const minStockQty = Math.max(0, Math.round(input.minStockQty || 0));

    await withWriteTx([db.items, db.units, db.audit_log], async () => {
      const existing = await db.items.get(itemId);
      if (!existing) {
        throw new Error('الصنف غير موجود.');
      }
      const duplicateSku = await db.items.where('sku').equals(sku).first();
      if (duplicateSku && duplicateSku.id !== itemId) {
        throw new Error(`كود الصنف (${sku}) مستخدم لصنف آخر.`);
      }

      const now = Date.now();
      await db.items.update(itemId, {
        name,
        sku,
        barcode,
        category,
        costPricePiastres: costPiastres,
        retailPricePiastres: pieceSalePiastres,
        wholesalePricePiastres: cartonSalePiastres,
        minStockQty,
        imageDataUrl: input.imageDataUrl !== undefined ? input.imageDataUrl : existing.imageDataUrl,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        updatedAt: now,
      });

      const units = await db.units.where('itemId').equals(itemId).toArray();
      const baseUnit = units.find((u) => u.isBase);
      const cartonUnit = units.find((u) => !u.isBase);

      if (baseUnit) {
        await db.units.update(baseUnit.id, {
          barcode,
          salePricePiastres: pieceSalePiastres,
          updatedAt: now,
        });
      }
      if (cartonUnit) {
        await db.units.update(cartonUnit.id, {
          conversionFactor: conversion,
          salePricePiastres: cartonSalePiastres,
          updatedAt: now,
        });
      } else {
        await db.units.add({
          id: generateUUID(),
          itemId,
          name: 'كرتونة',
          conversionFactor: conversion,
          barcode: '',
          salePricePiastres: cartonSalePiastres,
          isBase: false,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        });
      }

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'items',
        entityId: itemId,
        summary: `تعديل بيانات الصنف: ${name} (${sku})`,
        before: {
          name: existing.name,
          sku: existing.sku,
          costPricePiastres: existing.costPricePiastres,
          retailPricePiastres: existing.retailPricePiastres,
          wholesalePricePiastres: existing.wholesalePricePiastres,
          minStockQty: existing.minStockQty,
          cartonConversionFactor: cartonUnit?.conversionFactor ?? 1,
          isActive: existing.isActive,
        },
        after: {
          name,
          sku,
          costPricePiastres: costPiastres,
          retailPricePiastres: pieceSalePiastres,
          wholesalePricePiastres: cartonSalePiastres,
          minStockQty,
          cartonConversionFactor: conversion,
          isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        },
      });
    });
  },

  async toggleItemActive(
    actor: UserRecord,
    itemId: UUID,
    isActive: boolean
  ): Promise<void> {
    await runDatabaseMigrations();
    await withWriteTx([db.items, db.audit_log], async () => {
      const existing = await db.items.get(itemId);
      if (!existing) throw new Error('الصنف غير موجود.');
      await db.items.update(itemId, {isActive, updatedAt: Date.now()});
      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'items',
        entityId: itemId,
        summary: `${isActive ? 'تفعيل' : 'إيقاف'} الصنف: ${existing.name}`,
        before: {isActive: existing.isActive},
        after: {isActive},
      });
    });
  },

  async deleteItem(actor: UserRecord, itemId: UUID): Promise<void> {
    await runDatabaseMigrations();
    await withWriteTx(
      [db.items, db.units, db.stock_movements, db.purchase_invoice_lines, db.sales_invoice_lines, db.audit_log],
      async () => {
        const existing = await db.items.get(itemId);
        if (!existing) throw new Error('الصنف غير موجود.');

        const [movCount, purLineCount, saleLineCount] = await Promise.all([
          db.stock_movements.where('itemId').equals(itemId).count(),
          db.purchase_invoice_lines.where('itemId').equals(itemId).count(),
          db.sales_invoice_lines.where('itemId').equals(itemId).count(),
        ]);

        if (movCount > 0 || purLineCount > 0 || saleLineCount > 0) {
          throw new Error('لا يمكن حذف صنف له حركات مخزنية أو فواتير؛ يمكنك إيقافه فقط.');
        }

        await db.units.where('itemId').equals(itemId).delete();
        await db.items.delete(itemId);

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'update',
          entityType: 'items',
          entityId: itemId,
          summary: `حذف صنف بدون حركات: ${existing.name} (${existing.sku})`,
          before: {name: existing.name, sku: existing.sku, isActive: existing.isActive},
          after: null,
        });
      }
    );
  },

  async importItemsFromRows(
    actor: UserRecord,
    rows: ExcelItemImportRow[],
    warehouseId?: UUID
  ): Promise<ExcelImportResult> {
    await runDatabaseMigrations();
    return withWriteTx(
      [db.items, db.units, db.warehouses, db.stock_movements, db.audit_log],
      async () => {
        let targetWhId = warehouseId;
        if (!targetWhId) {
          const defWh = await db.warehouses.filter((w) => w.isDefault).first();
          targetWhId = defWh?.id ?? (await db.warehouses.toCollection().first())?.id;
        }

        const existingItems = await db.items.toArray();
        const existingSkus = new Set(existingItems.map((i) => i.sku.toUpperCase()));

        let importedCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];
        const now = Date.now();

        for (let idx = 0; idx < rows.length; idx += 1) {
          const row = rows[idx];
          const rowNum = idx + 2;
          const sku = row.sku.trim().toUpperCase();
          const name = row.name.trim();

          if (!sku || !name) {
            skippedCount += 1;
            errors.push(`سطر ${rowNum}: الكود والاسم مطلوبان.`);
            continue;
          }
          if (existingSkus.has(sku)) {
            skippedCount += 1;
            errors.push(`سطر ${rowNum}: الكود (${sku}) موجود مسبقاً.`);
            continue;
          }

          const conv = Math.max(1, Math.round(row.cartonConversionFactor || 1));
          const cost = Math.max(0, Math.round(row.costPricePiastres || 0));
          const piecePrice = Math.max(0, Math.round(row.pieceSalePricePiastres || 0));
          const cartonPrice = Math.max(
            0,
            Math.round(row.cartonSalePricePiastres || piecePrice * conv)
          );
          const minQty = Math.max(0, Math.round(row.minStockQty || 0));
          const openingQty = Math.max(0, Math.round(row.openingStockQty || 0));

          const itemId = generateUUID();
          const baseUnitId = generateUUID();

          await db.items.add({
            id: itemId,
            sku,
            barcode: (row.barcode ?? '').trim(),
            name,
            category: (row.category ?? 'بن').trim() || 'عام',
            baseUnitId,
            costPricePiastres: cost,
            wholesalePricePiastres: cartonPrice,
            retailPricePiastres: piecePrice,
            minStockQty: minQty,
            imageDataUrl: null,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            createdBy: actor.id,
          });

          await db.units.bulkAdd([
            {
              id: baseUnitId,
              itemId,
              name: 'قطعة',
              conversionFactor: 1,
              barcode: (row.barcode ?? '').trim(),
              salePricePiastres: piecePrice,
              isBase: true,
              createdAt: now,
              updatedAt: now,
              createdBy: actor.id,
            },
            {
              id: generateUUID(),
              itemId,
              name: 'كرتونة',
              conversionFactor: conv,
              barcode: '',
              salePricePiastres: cartonPrice,
              isBase: false,
              createdAt: now,
              updatedAt: now,
              createdBy: actor.id,
            },
          ]);

          if (openingQty > 0 && targetWhId) {
            await db.stock_movements.add({
              id: generateUUID(),
              itemId,
              warehouseId: targetWhId,
              movementType: 'opening',
              quantityDelta: openingQty,
              unitCostPiastres: cost,
              referenceType: 'excel_import',
              referenceId: itemId,
              notes: `رصيد افتتاحي عبر استيراد Excel (${sku})`,
              reversesId: null,
              createdAt: now,
              updatedAt: now,
              createdBy: actor.id,
            });
          }

          existingSkus.add(sku);
          importedCount += 1;
        }

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'items',
          entityId: 'excel_import',
          summary: `استيراد أصناف من Excel: تم استيراد ${importedCount} وتخطي ${skippedCount}`,
        });

        return {importedCount, skippedCount, errors};
      }
    );
  },
};

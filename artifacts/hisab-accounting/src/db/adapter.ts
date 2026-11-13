import { isTauri } from '@tauri-apps/api/core';
import {
  calculateAmounts,
  type Transaction,
  type TransactionDraft,
  type TransactionType,
} from '@/core/accounting';

type StorageMode = 'sqlite' | 'indexeddb';

interface TransactionRow {
  id: string;
  date: string;
  description: string;
  type: TransactionType;
  category: string;
  contact: string;
  reference: string;
  amountMinor: number;
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
  createdAt: string;
  updatedAt: string;
}

const DATABASE_NAME = 'hisab-accounting';
const TABLE_NAME = 'transactions';
const storageMode: StorageMode = isTauri() ? 'sqlite' : 'indexeddb';

let sqliteDatabase: Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-sql').default.load>
> | null = null;
let indexedDatabase: IDBDatabase | null = null;
let initialization: Promise<void> | null = null;

export function getStorageMode(): StorageMode {
  return storageMode;
}

export async function initializeDatabase(): Promise<void> {
  if (!initialization) {
    initialization = (
      storageMode === 'sqlite' ? initializeSqlite() : initializeIndexedDb()
    ).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

async function initializeSqlite(): Promise<void> {
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  sqliteDatabase = await Database.load('sqlite:hisab.db');
  await sqliteDatabase.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      category TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      amountMinor INTEGER NOT NULL CHECK (amountMinor >= 0),
      taxRateBps INTEGER NOT NULL CHECK (taxRateBps >= 0),
      taxMinor INTEGER NOT NULL CHECK (taxMinor >= 0),
      totalMinor INTEGER NOT NULL CHECK (totalMinor >= amountMinor),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  await sqliteDatabase.execute(
    'CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC)',
  );
  await sqliteDatabase.execute(
    'CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions(type)',
  );
}

async function initializeIndexedDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('هذا المتصفح لا يدعم التخزين المحلي المطلوب.');
  }

  indexedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TABLE_NAME)) {
        const store = database.createObjectStore(TABLE_NAME, {
          keyPath: 'id',
        });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('تعذر فتح قاعدة البيانات المحلية.'));
    request.onblocked = () =>
      reject(new Error('أغلق النسخ الأخرى من التطبيق ثم أعد المحاولة.'));
  });
}

export async function listTransactions(): Promise<Transaction[]> {
  await initializeDatabase();

  let records: TransactionRow[];
  if (storageMode === 'sqlite') {
    if (!sqliteDatabase) throw new Error('قاعدة SQLite غير جاهزة.');
    records = await sqliteDatabase.select<TransactionRow[]>(
      'SELECT * FROM transactions ORDER BY date DESC, createdAt DESC',
    );
  } else {
    if (!indexedDatabase) throw new Error('قاعدة المتصفح غير جاهزة.');
    records = await indexedRequest<TransactionRow[]>(
      indexedDatabase
        .transaction(TABLE_NAME, 'readonly')
        .objectStore(TABLE_NAME)
        .getAll(),
    );
  }

  return records.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

export async function saveTransaction(
  draft: TransactionDraft,
): Promise<Transaction> {
  await initializeDatabase();
  const id = draft.id ?? crypto.randomUUID();
  const previous = draft.id ? await findTransaction(id) : undefined;
  const { taxMinor, totalMinor } = calculateAmounts(
    draft.amountMinor,
    draft.taxRateBps,
  );
  const now = new Date().toISOString();
  const record: TransactionRow = {
    id,
    date: draft.date,
    description: draft.description.trim(),
    type: draft.type,
    category: draft.category.trim(),
    contact: draft.contact.trim(),
    reference: draft.reference.trim(),
    amountMinor: draft.amountMinor,
    taxRateBps: draft.taxRateBps,
    taxMinor,
    totalMinor,
    createdAt: previous?.createdAt ?? draft.createdAt ?? now,
    updatedAt: now,
  };

  if (!record.description) throw new Error('أدخل وصفًا للمعاملة.');
  if (!record.category) throw new Error('اختر تصنيفًا للمعاملة.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    throw new Error('أدخل تاريخًا صالحًا للمعاملة.');
  }

  if (storageMode === 'sqlite') {
    if (!sqliteDatabase) throw new Error('قاعدة SQLite غير جاهزة.');
    await sqliteDatabase.execute(
      `INSERT INTO transactions (
        id, date, description, type, category, contact, reference,
        amountMinor, taxRateBps, taxMinor, totalMinor, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        description = excluded.description,
        type = excluded.type,
        category = excluded.category,
        contact = excluded.contact,
        reference = excluded.reference,
        amountMinor = excluded.amountMinor,
        taxRateBps = excluded.taxRateBps,
        taxMinor = excluded.taxMinor,
        totalMinor = excluded.totalMinor,
        updatedAt = excluded.updatedAt`,
      [
        record.id,
        record.date,
        record.description,
        record.type,
        record.category,
        record.contact,
        record.reference,
        record.amountMinor,
        record.taxRateBps,
        record.taxMinor,
        record.totalMinor,
        record.createdAt,
        record.updatedAt,
      ],
    );
  } else {
    if (!indexedDatabase) throw new Error('قاعدة المتصفح غير جاهزة.');
    await indexedWrite(indexedDatabase, (store) => store.put(record));
  }

  return record;
}

export async function deleteTransaction(id: string): Promise<void> {
  await initializeDatabase();
  if (storageMode === 'sqlite') {
    if (!sqliteDatabase) throw new Error('قاعدة SQLite غير جاهزة.');
    await sqliteDatabase.execute('DELETE FROM transactions WHERE id = ?', [id]);
  } else {
    if (!indexedDatabase) throw new Error('قاعدة المتصفح غير جاهزة.');
    await indexedWrite(indexedDatabase, (store) => store.delete(id));
  }
}

async function findTransaction(id: string): Promise<TransactionRow | undefined> {
  if (storageMode === 'sqlite') {
    if (!sqliteDatabase) throw new Error('قاعدة SQLite غير جاهزة.');
    const rows = await sqliteDatabase.select<TransactionRow[]>(
      'SELECT * FROM transactions WHERE id = ? LIMIT 1',
      [id],
    );
    return rows[0];
  }

  if (!indexedDatabase) throw new Error('قاعدة المتصفح غير جاهزة.');
  return indexedRequest<TransactionRow | undefined>(
    indexedDatabase
      .transaction(TABLE_NAME, 'readonly')
      .objectStore(TABLE_NAME)
      .get(id),
  );
}

function indexedRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('فشلت عملية قاعدة البيانات المحلية.'));
  });
}

function indexedWrite<T>(
  database: IDBDatabase,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TABLE_NAME, 'readwrite');
    const request = operation(transaction.objectStore(TABLE_NAME));
    let result: T;

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () =>
      reject(request.error ?? new Error('فشلت عملية قاعدة البيانات المحلية.'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error('تعذر حفظ التغيير على هذا الجهاز.'),
      );
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('تم إلغاء حفظ التغيير.'));
  });
}

import SQLite from 'react-native-sqlite-storage';
import {
  Account,
  Debt,
  DebtStatus,
  DebtTransaction,
  DebtType,
  QuickTransaction,
} from './models';

SQLite.enablePromise(true);

type SQLiteDatabase = any;

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function ensureColumns(
  db: SQLiteDatabase,
  tableName: string,
  requiredColumns: Record<string, string>,
): Promise<void> {
  try {
    const [res] = await db.executeSql(`PRAGMA table_info(${tableName});`);
    const existingCols = new Set<string>();
    for (let i = 0; i < res.rows.length; i++) {
      const col = res.rows.item(i);
      if (col && col.name) {
        existingCols.add(col.name.toLowerCase());
      }
    }
    for (const [colName, colDef] of Object.entries(requiredColumns)) {
      if (!existingCols.has(colName.toLowerCase())) {
        try {
          await db.executeSql(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef};`);
          console.log(`Added column ${colName} to ${tableName}`);
        } catch (alterErr) {
          console.warn(`Could not add column ${colName} to ${tableName}:`, alterErr);
        }
      }
    }
  } catch (err) {
    console.warn(`PRAGMA table_info failed for ${tableName}:`, err);
  }
}

export async function ensureTablesAndMigrations(db: SQLiteDatabase): Promise<void> {
  const queries = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      account_id INTEGER,
      category TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );`,
    `CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name TEXT NOT NULL,
      phone TEXT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      note TEXT,
      due_date TEXT,
      date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS debt_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      type TEXT NOT NULL DEFAULT 'repayment',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (debt_id) REFERENCES debts(id)
    );`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );`,
  ];

  for (const query of queries) {
    try {
      await db.executeSql(query);
    } catch (e) {
      console.warn('Table creation query error:', e);
    }
  }

  // Auto-migrate tables with missing columns
  await ensureColumns(db, 'debts', {
    phone: 'TEXT',
    remaining_amount: 'REAL DEFAULT 0',
    note: 'TEXT',
    due_date: 'TEXT',
    date: 'TEXT',
    status: "TEXT DEFAULT 'pending'",
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
    updated_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
  });

  await ensureColumns(db, 'debt_transactions', {
    type: "TEXT DEFAULT 'repayment'",
    note: 'TEXT',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
  });

  await ensureColumns(db, 'transactions', {
    category: 'TEXT',
    account_id: 'INTEGER',
    to_account_id: 'INTEGER',
    note: 'TEXT',
    ref_id: 'TEXT',
  });

  await ensureColumns(db, 'accounts', {
    balance: 'REAL DEFAULT 0',
    type: 'TEXT',
  });

  // Ensure NULL values in existing debts are filled
  try {
    // Populate missing/null/invalid id column values with rowid so each row has a guaranteed unique permanent ID
    await db.executeSql(
      "UPDATE debts SET id = CAST(rowid AS TEXT) WHERE id IS NULL OR id = '' OR id = 'null' OR id = 'undefined';",
    );
    await db.executeSql(
      'UPDATE debts SET remaining_amount = amount WHERE remaining_amount IS NULL;',
    );
    await db.executeSql(
      "UPDATE debts SET status = 'pending' WHERE status IS NULL OR status = '';",
    );
    await db.executeSql(
      "UPDATE debts SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = '';",
    );
    await db.executeSql(
      'UPDATE debts SET date = created_at WHERE date IS NULL OR date = \'\';',
    );
    try {
      await db.executeSql(
        "UPDATE debts SET note = notes WHERE (note IS NULL OR note = '') AND notes IS NOT NULL;",
      );
    } catch {}
  } catch (e) {
    // ignore
  }

  // Purge any fake promo transactions and duplicate status updates
  await cleanExistingDuplicatesAndFakeTransactions(db);
}

async function cleanExistingDuplicatesAndFakeTransactions(db: SQLiteDatabase): Promise<void> {
  try {
    // 1. Delete known fake promotional transactions
    const fakeKeywords = [
      '%Joins Revolut Earn%',
      '%Was Fast Your Transfer%',
      '%Transfer to News%',
      '%Transfer to Scopex%',
    ];

    for (const pattern of fakeKeywords) {
      const [fakeRows] = await db.executeSql(
        'SELECT id, amount, type, account_id FROM transactions WHERE note LIKE ?',
        [pattern],
      );
      if (fakeRows && fakeRows.rows.length > 0) {
        for (let i = 0; i < fakeRows.rows.length; i++) {
          const row = fakeRows.rows.item(i);
          if (row.account_id) {
            const delta = row.type === 'income' ? -Number(row.amount) : Number(row.amount);
            await db.executeSql(
              'UPDATE accounts SET balance = balance + ? WHERE id = ?',
              [delta, row.account_id],
            );
          }
          await db.executeSql('DELETE FROM transactions WHERE id = ?', [row.id]);
        }
      }
    }

    // 2. Deduplicate existing duplicate transactions (same amount, same type within 24 hours)
    const [allTxs] = await db.executeSql(
      'SELECT id, type, amount, note, account_id, created_at, ref_id FROM transactions ORDER BY created_at ASC, id ASC',
    );
    if (allTxs && allTxs.rows.length > 1) {
      const seen: any[] = [];
      const toDelete: any[] = [];

      for (let i = 0; i < allTxs.rows.length; i++) {
        const tx = allTxs.rows.item(i);
        const time = new Date(tx.created_at).getTime() || 0;
        const amt = Math.round(Number(tx.amount) * 100);

        let isDup = false;
        for (const existing of seen) {
          const existingAmt = Math.round(Number(existing.amount) * 100);
          if (
            existing.type === tx.type &&
            existingAmt === amt &&
            Math.abs(time - existing.time) < 24 * 3600 * 1000
          ) {
            isDup = true;
            toDelete.push(tx);
            break;
          }
        }

        if (!isDup) {
          seen.push({ ...tx, time });
        }
      }

      for (const dup of toDelete) {
        if (dup.account_id) {
          const delta = dup.type === 'income' ? -Number(dup.amount) : Number(dup.amount);
          await db.executeSql(
            'UPDATE accounts SET balance = balance + ? WHERE id = ?',
            [delta, dup.account_id],
          );
        }
        await db.executeSql('DELETE FROM transactions WHERE id = ?', [dup.id]);
      }
    }
  } catch (err) {
    console.warn('[localDb] Error cleaning duplicates:', err);
  }
}

async function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabase({ name: 'fiscus.db', location: 'default' });
      await ensureTablesAndMigrations(db);
      return db;
    })();
  }
  return dbPromise;
}

export async function cleanExistingDuplicateTransactions(): Promise<{ removedCount: number }> {
  const db = await getDb();
  try {
    const [result] = await db.executeSql(
      `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.created_at as createdAt
       FROM transactions t
       ORDER BY t.created_at ASC, t.id ASC`
    );
    const rows = result.rows;
    const kept: any[] = [];
    const toDeleteIds: number[] = [];

    for (let i = 0; i < rows.length; i++) {
      const current = rows.item(i);
      const currentTime = new Date(current.createdAt).getTime();

      const duplicateOf = kept.find(prev => {
        const prevTime = new Date(prev.createdAt).getTime();
        const sameAmount = Math.abs(Number(prev.amount) - Number(current.amount)) < 0.01;
        const sameType = prev.type === current.type;
        const sameAccount = (prev.accountId && current.accountId && prev.accountId === current.accountId) ||
                            (!prev.accountId && !current.accountId);
        const timeDiff = Math.abs(currentTime - prevTime);

        // Within 12 hours from same account
        if (sameAmount && sameType && sameAccount && timeDiff < 12 * 3600 * 1000) {
          const prevNote = (prev.note || '').trim().toLowerCase();
          const currNote = (current.note || '').trim().toLowerCase();
          if (prevNote === currNote) return true;
          if (!prevNote || !currNote) return true;
          if (prevNote.includes('wise') && currNote.includes('wise')) return true;
          if (prevNote.includes('transfer') && currNote.includes('transfer')) return true;
          if (prevNote.includes('scopex') && currNote.includes('scopex')) return true;
          if (prevNote.includes('was fast') || currNote.includes('was fast')) return true;
          if (currNote === 'transfer to news') return true;
          if (timeDiff < 60 * 60 * 1000) return true;
        }
        return false;
      });

      if (duplicateOf) {
        toDeleteIds.push(current.id);
        const prevNote = (duplicateOf.note || '').trim();
        const currNote = (current.note || '').trim();
        if ((!prevNote || prevNote.includes('Was Fast') || prevNote === 'Transfer to News') &&
            currNote && !currNote.includes('Was Fast') && currNote !== 'Transfer to News') {
          await db.executeSql('UPDATE transactions SET note = ? WHERE id = ?', [currNote, duplicateOf.id]);
          duplicateOf.note = currNote;
        }
      } else {
        kept.push(current);
      }
    }

    if (toDeleteIds.length > 0) {
      console.log(`[LocalDb] Purging ${toDeleteIds.length} duplicate transactions from database...`);
      for (const delId of toDeleteIds) {
        const [txRow] = await db.executeSql('SELECT * FROM transactions WHERE id = ?', [delId]);
        if (txRow && txRow.rows.length > 0) {
          const item = txRow.rows.item(0);
          if (item.account_id) {
            const delta = item.type === 'income' ? -Number(item.amount) : Number(item.amount);
            await db.executeSql('UPDATE accounts SET balance = balance + ? WHERE id = ?', [delta, item.account_id]);
          }
        }
        await db.executeSql('DELETE FROM transactions WHERE id = ?', [delId]);
      }
    }

    return { removedCount: toDeleteIds.length };
  } catch (err) {
    console.warn('[LocalDb] Error during duplicate transactions cleanup:', err);
    return { removedCount: 0 };
  }
}

export async function initLocalDb(): Promise<void> {
  const db = await getDb();
  await ensureTablesAndMigrations(db);
  await cleanExistingDuplicateTransactions();
}


export async function setLocalSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value],
  );
}

export async function getLocalSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const [result] = await db.executeSql('SELECT value FROM settings WHERE key = ?', [key]);
  if (!result.rows.length) {
    return null;
  }
  return result.rows.item(0).value ?? null;
}

export async function clearLocalData(): Promise<void> {
  const db = await getDb();
  await db.executeSql('DELETE FROM debt_transactions');
  await db.executeSql('DELETE FROM debts');
  await db.executeSql('DELETE FROM transactions');
  await db.executeSql('DELETE FROM accounts');
}

export async function clearLocalTransactionsOnly(): Promise<void> {
  const db = await getDb();
  await db.executeSql('DELETE FROM transactions');
  await db.executeSql('UPDATE accounts SET balance = 0');
}

const toDebt = (row: any): Debt => {
  let resolvedId = row.id;
  if (!resolvedId || resolvedId === 'null' || resolvedId === 'undefined') {
    resolvedId = row.rowid ? String(row.rowid) : `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  }
  return {
    id: String(resolvedId),
    personName: row.person_name || row.personName || '',
    phone: row.phone || undefined,
    type: (row.type === 'borrowed' ? 'borrowed' : 'lent') as DebtType,
    amount: Number(row.amount || 0),
    remainingAmount: Number(row.remaining_amount ?? row.remainingAmount ?? row.amount ?? 0),
    note: row.note || row.notes || undefined,
    dueDate: row.due_date || row.dueDate || undefined,
    status: (row.status || 'pending') as DebtStatus,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
};

const toDebtTransaction = (row: any): DebtTransaction => ({
  id: String(row.id),
  debtId: String(row.debt_id || row.debtId),
  amount: Number(row.amount || 0),
  note: row.note || undefined,
  type: row.type === 'additional' ? 'additional' : 'repayment',
  createdAt: row.created_at || row.createdAt || new Date().toISOString(),
});

export async function fetchLocalDebts(): Promise<Debt[]> {
  const db = await getDb();
  let result;
  try {
    [result] = await db.executeSql(
      'SELECT rowid, * FROM debts ORDER BY updated_at DESC, rowid DESC',
    );
  } catch {
    try {
      [result] = await db.executeSql('SELECT rowid, * FROM debts ORDER BY rowid DESC');
    } catch {
      return [];
    }
  }
  const rows = result ? result.rows : { length: 0 };
  const list: Debt[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    list.push(toDebt(rows.item(i)));
  }
  return list;
}

export async function createLocalDebt(payload: {
  id?: string;
  personName: string;
  phone?: string;
  type: DebtType;
  amount: number;
  note?: string;
  dueDate?: string;
}): Promise<Debt> {
  const db = await getDb();
  const now = new Date().toISOString();
  const amount = Number(payload.amount || 0);
  const debtId = payload.id || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Guarantee columns exist
  await ensureColumns(db, 'debts', {
    id: 'TEXT PRIMARY KEY',
    phone: 'TEXT',
    remaining_amount: 'REAL DEFAULT 0',
    note: 'TEXT',
    due_date: 'TEXT',
    date: 'TEXT',
    status: "TEXT DEFAULT 'pending'",
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
    updated_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
  });

  await db.executeSql(
    `INSERT INTO debts (id, person_name, phone, type, amount, remaining_amount, note, due_date, date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      debtId,
      payload.personName,
      payload.phone || null,
      payload.type,
      amount,
      amount,
      payload.note || null,
      payload.dueDate || null,
      now,
      now,
      now,
    ],
  );

  return {
    id: debtId,
    personName: payload.personName,
    phone: payload.phone,
    type: payload.type,
    amount,
    remainingAmount: amount,
    note: payload.note,
    dueDate: payload.dueDate,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateLocalDebt(
  id: string,
  payload: {
    personName: string;
    phone?: string;
    type: DebtType;
    amount: number;
    remainingAmount?: number;
    note?: string;
    dueDate?: string;
    status?: DebtStatus;
  },
): Promise<Debt> {
  const db = await getDb();
  const now = new Date().toISOString();
  const amount = Number(payload.amount || 0);
  const remaining = payload.remainingAmount !== undefined
    ? Number(payload.remainingAmount)
    : amount;
  const status = payload.status || (remaining <= 0 ? 'settled' : remaining < amount ? 'partially_paid' : 'pending');
  const numId = Number(id) || 0;

  await db.executeSql(
    `UPDATE debts SET person_name = ?, phone = ?, type = ?, amount = ?, remaining_amount = ?, note = ?, due_date = ?, status = ?, updated_at = ?
     WHERE id = ? OR rowid = ?`,
    [
      payload.personName,
      payload.phone || null,
      payload.type,
      amount,
      remaining,
      payload.note || null,
      payload.dueDate || null,
      status,
      now,
      id,
      numId,
    ],
  );

  return {
    id,
    personName: payload.personName,
    phone: payload.phone,
    type: payload.type,
    amount,
    remainingAmount: remaining,
    note: payload.note,
    dueDate: payload.dueDate,
    status,
    createdAt: now,
    updatedAt: now,
  };
}

export async function deleteLocalDebt(id: string): Promise<void> {
  const db = await getDb();
  const numId = Number(id) || 0;
  await db.executeSql(
    'DELETE FROM debt_transactions WHERE debt_id = ? OR debt_id = ?',
    [id, numId],
  );
  try {
    await db.executeSql(
      'DELETE FROM debt_payments WHERE debt_id = ? OR debt_id = ?',
      [id, numId],
    );
  } catch {}
  await db.executeSql(
    'DELETE FROM debts WHERE id = ? OR rowid = ?',
    [id, numId],
  );
}

export async function addDebtRepayment(
  debtId: string,
  amount: number,
  note?: string,
): Promise<{ debt: Debt; transaction: DebtTransaction }> {
  const db = await getDb();

  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS debt_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      type TEXT NOT NULL DEFAULT 'repayment',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (debt_id) REFERENCES debts(id)
    );`,
  );

  const numId = Number(debtId) || 0;
  const [debtResult] = await db.executeSql(
    'SELECT rowid, * FROM debts WHERE id = ? OR rowid = ?',
    [debtId, numId],
  );
  if (!debtResult || !debtResult.rows.length) {
    throw new Error('Debt record not found');
  }
  const currentDebt = toDebt(debtResult.rows.item(0));
  const payAmount = Number(amount || 0);
  const now = new Date().toISOString();

  const txResult = await db.executeSql(
    'INSERT INTO debt_transactions (debt_id, amount, note, type, created_at) VALUES (?, ?, ?, ?, ?)',
    [currentDebt.id, payAmount, note || null, 'repayment', now],
  );

  let txInsertId = txResult && txResult[0] ? txResult[0].insertId : undefined;
  if (!txInsertId || txInsertId <= 0) {
    try {
      const [lastRes] = await db.executeSql('SELECT last_insert_rowid() as id');
      if (lastRes && lastRes.rows.length > 0) {
        txInsertId = lastRes.rows.item(0).id;
      }
    } catch {}
  }

  const nextRemaining = Math.max(0, currentDebt.remainingAmount - payAmount);
  const nextStatus: DebtStatus = nextRemaining <= 0 ? 'settled' : 'partially_paid';

  await db.executeSql(
    'UPDATE debts SET remaining_amount = ?, status = ?, updated_at = ? WHERE id = ? OR rowid = ?',
    [nextRemaining, nextStatus, now, currentDebt.id, numId],
  );

  let updatedDebt: Debt = {
    ...currentDebt,
    remainingAmount: nextRemaining,
    status: nextStatus,
    updatedAt: now,
  };

  try {
    const [updatedDebtResult] = await db.executeSql(
      'SELECT rowid, * FROM debts WHERE id = ? OR rowid = ?',
      [currentDebt.id, numId],
    );
    if (updatedDebtResult && updatedDebtResult.rows.length > 0) {
      updatedDebt = toDebt(updatedDebtResult.rows.item(0));
    }
  } catch {}

  let txObj: DebtTransaction = {
    id: String(txInsertId || Date.now()),
    debtId: currentDebt.id,
    amount: payAmount,
    note,
    type: 'repayment',
    createdAt: now,
  };

  if (txInsertId) {
    try {
      const [txRowResult] = await db.executeSql('SELECT * FROM debt_transactions WHERE id = ?', [txInsertId]);
      if (txRowResult && txRowResult.rows.length > 0) {
        txObj = toDebtTransaction(txRowResult.rows.item(0));
      }
    } catch {}
  }

  return {
    debt: updatedDebt,
    transaction: txObj,
  };
}

export async function addDebtAdditional(
  debtId: string,
  amount: number,
  note?: string,
): Promise<{ debt: Debt; transaction: DebtTransaction }> {
  const db = await getDb();
  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS debt_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      type TEXT NOT NULL DEFAULT 'repayment',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (debt_id) REFERENCES debts(id)
    );`,
  );

  const numId = Number(debtId) || 0;
  const [debtResult] = await db.executeSql(
    'SELECT rowid, * FROM debts WHERE id = ? OR rowid = ?',
    [debtId, numId],
  );
  if (!debtResult || !debtResult.rows.length) {
    throw new Error('Debt record not found');
  }
  const currentDebt = toDebt(debtResult.rows.item(0));
  const addAmount = Number(amount || 0);
  const now = new Date().toISOString();

  const txResult = await db.executeSql(
    'INSERT INTO debt_transactions (debt_id, amount, note, type, created_at) VALUES (?, ?, ?, ?, ?)',
    [currentDebt.id, addAmount, note || null, 'additional', now],
  );

  let txInsertId = txResult && txResult[0] ? txResult[0].insertId : undefined;
  if (!txInsertId || txInsertId <= 0) {
    try {
      const [lastRes] = await db.executeSql('SELECT last_insert_rowid() as id');
      if (lastRes && lastRes.rows.length > 0) {
        txInsertId = lastRes.rows.item(0).id;
      }
    } catch {}
  }

  const nextAmount = currentDebt.amount + addAmount;
  const nextRemaining = currentDebt.remainingAmount + addAmount;
  const nextStatus: DebtStatus = 'pending';

  await db.executeSql(
    'UPDATE debts SET amount = ?, remaining_amount = ?, status = ?, updated_at = ? WHERE id = ? OR rowid = ?',
    [nextAmount, nextRemaining, nextStatus, now, currentDebt.id, numId],
  );

  let updatedDebt: Debt = {
    ...currentDebt,
    amount: nextAmount,
    remainingAmount: nextRemaining,
    status: nextStatus,
    updatedAt: now,
  };

  try {
    const [updatedDebtResult] = await db.executeSql(
      'SELECT rowid, * FROM debts WHERE id = ? OR rowid = ?',
      [currentDebt.id, numId],
    );
    if (updatedDebtResult && updatedDebtResult.rows.length > 0) {
      updatedDebt = toDebt(updatedDebtResult.rows.item(0));
    }
  } catch {}

  let txObj: DebtTransaction = {
    id: String(txInsertId || Date.now()),
    debtId: currentDebt.id,
    amount: addAmount,
    note,
    type: 'additional',
    createdAt: now,
  };

  if (txInsertId) {
    try {
      const [txRowResult] = await db.executeSql('SELECT * FROM debt_transactions WHERE id = ?', [txInsertId]);
      if (txRowResult && txRowResult.rows.length > 0) {
        txObj = toDebtTransaction(txRowResult.rows.item(0));
      }
    } catch {}
  }

  return {
    debt: updatedDebt,
    transaction: txObj,
  };
}

export async function fetchDebtTransactions(debtId: string): Promise<DebtTransaction[]> {
  const db = await getDb();
  const numId = Number(debtId) || 0;
  const [result] = await db.executeSql(
    'SELECT * FROM debt_transactions WHERE debt_id = ? OR debt_id = ? ORDER BY created_at DESC, id DESC',
    [debtId, numId],
  );
  const rows = result ? result.rows : { length: 0 };
  const list: DebtTransaction[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    list.push(toDebtTransaction(rows.item(i)));
  }
  return list;
}

export async function deleteDebtTransaction(
  debtId: string,
  transactionId: string,
): Promise<Debt | null> {
  const db = await getDb();
  const numTxId = Number(transactionId) || 0;
  const [txResult] = await db.executeSql(
    'SELECT * FROM debt_transactions WHERE id = ? OR id = ?',
    [transactionId, numTxId],
  );
  if (!txResult || !txResult.rows.length) {
    return null;
  }
  const tx = toDebtTransaction(txResult.rows.item(0));

  const numDebtId = Number(debtId) || 0;
  const [debtResult] = await db.executeSql(
    'SELECT rowid, * FROM debts WHERE id = ? OR rowid = ?',
    [debtId, numDebtId],
  );
  if (!debtResult || !debtResult.rows.length) {
    await db.executeSql('DELETE FROM debt_transactions WHERE id = ? OR id = ?', [
      transactionId,
      numTxId,
    ]);
    return null;
  }
  const currentDebt = toDebt(debtResult.rows.item(0));
  const now = new Date().toISOString();

  let nextAmount = currentDebt.amount;
  let nextRemaining = currentDebt.remainingAmount;
  let nextStatus: DebtStatus = currentDebt.status;

  if (tx.type === 'additional') {
    nextAmount = Math.max(0, currentDebt.amount - tx.amount);
    nextRemaining = Math.max(0, currentDebt.remainingAmount - tx.amount);
    nextStatus =
      nextRemaining <= 0
        ? 'settled'
        : nextRemaining < nextAmount
        ? 'partially_paid'
        : 'pending';
  } else {
    // repayment reversal
    nextRemaining = Math.min(
      currentDebt.amount,
      currentDebt.remainingAmount + tx.amount,
    );
    nextStatus =
      nextRemaining >= currentDebt.amount ? 'pending' : 'partially_paid';
  }

  await db.executeSql(
    'UPDATE debts SET amount = ?, remaining_amount = ?, status = ?, updated_at = ? WHERE id = ? OR rowid = ?',
    [nextAmount, nextRemaining, nextStatus, now, currentDebt.id, numDebtId],
  );

  await db.executeSql(
    'DELETE FROM debt_transactions WHERE id = ? OR id = ?',
    [transactionId, numTxId],
  );

  const [refreshedResult] = await db.executeSql(
    'SELECT rowid, * FROM debts WHERE id = ? OR rowid = ?',
    [currentDebt.id, numDebtId],
  );
  if (refreshedResult && refreshedResult.rows.length > 0) {
    return toDebt(refreshedResult.rows.item(0));
  }
  return {
    ...currentDebt,
    amount: nextAmount,
    remainingAmount: nextRemaining,
    status: nextStatus,
    updatedAt: now,
  };
}

export async function exportFullBackupData(): Promise<string> {
  const db = await getDb();
  const accounts = await fetchLocalAccounts();
  const transactions = await fetchLocalTransactions();
  const debts = await fetchLocalDebts();

  const [allDebtTxResult] = await db.executeSql('SELECT * FROM debt_transactions');
  const debtTransactions: DebtTransaction[] = [];
  for (let i = 0; i < allDebtTxResult.rows.length; i += 1) {
    debtTransactions.push(toDebtTransaction(allDebtTxResult.rows.item(i)));
  }

  const [settingsResult] = await db.executeSql('SELECT * FROM settings');
  const settings: Record<string, string> = {};
  for (let i = 0; i < settingsResult.rows.length; i += 1) {
    const item = settingsResult.rows.item(i);
    if (item.key) {
      settings[item.key] = item.value;
    }
  }

  const backupObject = {
    version: 1,
    appName: 'Fiscus',
    exportedAt: new Date().toISOString(),
    stats: {
      accountsCount: accounts.length,
      transactionsCount: transactions.length,
      debtsCount: debts.length,
    },
    data: {
      accounts,
      transactions,
      debts,
      debtTransactions,
      settings,
    },
  };

  return JSON.stringify(backupObject, null, 2);
}

export async function restoreFullBackupData(
  jsonString: string,
): Promise<{
  success: boolean;
  accountsCount: number;
  transactionsCount: number;
  debtsCount: number;
}> {
  const parsed = JSON.parse(jsonString);
  if (!parsed || !parsed.data) {
    throw new Error('Invalid backup file format');
  }

  const db = await getDb();
  await ensureTablesAndMigrations(db);
  const { accounts = [], transactions = [], debts = [], debtTransactions = [], settings = {} } = parsed.data;

  // Temporarily disable foreign keys during bulk restore
  try {
    await db.executeSql('PRAGMA foreign_keys = OFF;');
  } catch {}

  // Clear existing tables
  await db.executeSql('DELETE FROM debt_transactions');
  await db.executeSql('DELETE FROM debts');
  await db.executeSql('DELETE FROM transactions');
  await db.executeSql('DELETE FROM accounts');

  // Restore accounts
  for (const acc of accounts) {
    await db.executeSql(
      'INSERT INTO accounts (id, name, type, balance) VALUES (?, ?, ?, ?)',
      [acc.id, acc.name, acc.type, acc.balance],
    );
  }

  // Restore transactions
  for (const tx of transactions) {
    await db.executeSql(
      'INSERT INTO transactions (id, type, amount, note, account_id, to_account_id, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [tx.id, tx.type, tx.amount, tx.note || null, tx.accountId || null, tx.toAccountId || tx.to_account_id || null, tx.category || null, tx.createdAt],
    );
  }

  // Restore debts
  for (const d of debts) {
    await db.executeSql(
      `INSERT INTO debts (id, person_name, phone, type, amount, remaining_amount, note, due_date, date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.id,
        d.personName,
        d.phone || null,
        d.type,
        d.amount,
        d.remainingAmount ?? d.amount,
        d.note || null,
        d.dueDate || null,
        d.createdAt || new Date().toISOString(),
        d.status || 'pending',
        d.createdAt || new Date().toISOString(),
        d.updatedAt || d.createdAt || new Date().toISOString(),
      ],
    );
  }

  // Restore debt transactions
  for (const dt of debtTransactions) {
    await db.executeSql(
      'INSERT INTO debt_transactions (id, debt_id, amount, note, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [dt.id, dt.debtId, dt.amount, dt.note || null, dt.type || 'repayment', dt.createdAt],
    );
  }

  // Restore settings
  for (const [key, value] of Object.entries(settings)) {
    await db.executeSql(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, String(value)],
    );
  }

  try {
    await db.executeSql('PRAGMA foreign_keys = ON;');
  } catch {}

  return {
    success: true,
    accountsCount: accounts.length,
    transactionsCount: transactions.length,
    debtsCount: debts.length,
  };
}

export async function seedLocalDataIfEmpty(): Promise<void> {
  const db = await getDb();
  const [accountCount] = await db.executeSql('SELECT COUNT(*) as count FROM accounts');
  const count = accountCount.rows.item(0).count as number;
  if (count > 0) {
    return;
  }

  const accounts: Array<{ name: string; type: Account['type']; balance: number }> = [
    { name: 'Sparkasse', type: 'bank', balance: 1500.2 },
    { name: 'Revolut', type: 'wallet', balance: 800 },
    { name: 'Chillar', type: 'wallet', balance: 120.3 },
  ];

  for (const account of accounts) {
    await createLocalAccount(account);
  }

  const categories = [
    'Groceries',
    'Bills',
    'Shopping',
    'Travel',
    'Salary',
    'Bonus',
    'Other',
  ];
  const notes = [
    'Lidl Groceries',
    'Metro Transport',
    'Zara Clothing',
    'Internet Bill',
    'Coffee Shop',
    'Weekend Trip',
    'Project Bonus',
    'Salary',
  ];

  const now = new Date();
  for (let monthOffset = 0; monthOffset < 3; monthOffset += 1) {
    for (let i = 0; i < 12; i += 1) {
      const date = new Date(now);
      date.setMonth(now.getMonth() - monthOffset);
      date.setDate(1 + (i * 2) % 27);
      const type = i % 5 === 0 ? 'income' : 'expense';
      const amount = type === 'income'
        ? 200 + Math.round(Math.random() * 600)
        : 10 + Math.round(Math.random() * 140);
      const account = accounts[(i + monthOffset) % accounts.length];
      const category = type === 'income' ? categories[4 + (i % 2)] : categories[i % 4];
      const note = notes[i % notes.length];

      await createLocalTransaction({
        type,
        amount,
        note,
        accountName: account.name,
        accountType: account.type as Account['type'],
        category,
        createdAt: date.toISOString(),
      });
    }
  }

  const [debtCountResult] = await db.executeSql('SELECT COUNT(*) as count FROM debts');
  const debtCount = debtCountResult.rows.item(0).count as number;
  if (debtCount === 0) {
    const d1 = await createLocalDebt({
      personName: 'Zaid Khan',
      phone: '+92 300 1234567',
      type: 'lent',
      amount: 5000,
      note: 'Office lunch & fuel advance',
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    });
    await addDebtRepayment(d1.id, 2000, 'Paid half back via Easypaisa');

    await createLocalDebt({
      personName: 'Tariq Shopkeeper',
      phone: '+92 321 9876543',
      type: 'borrowed',
      amount: 1500,
      note: 'Monthly grocery udhaar',
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    });
  }
}

const toAccount = (row: any): Account => ({
  id: String(row.id),
  name: row.name,
  type: row.type,
  balance: Number(row.balance || 0),
});

const toTransaction = (row: any): QuickTransaction => ({
  id: String(row.id),
  type: row.type,
  amount: Number(row.amount || 0),
  note: row.note || '',
  createdAt: row.createdAt || row.created_at || new Date().toISOString(),
  accountId: row.accountId ? String(row.accountId) : row.account_id ? String(row.account_id) : undefined,
  accountName: row.accountName || undefined,
  accountType: row.accountType || undefined,
  toAccountId: row.toAccountId ? String(row.toAccountId) : row.to_account_id ? String(row.to_account_id) : undefined,
  toAccountName: row.toAccountName || undefined,
  toAccountType: row.toAccountType || undefined,
  category: row.category || undefined,
  refId: row.refId || row.ref_id || undefined,
});

export async function fetchLocalAccounts(): Promise<Account[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT * FROM accounts ORDER BY created_at DESC',
  );
  const rows = result.rows;
  const list: Account[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    list.push(toAccount(rows.item(i)));
  }
  return list;
}

export async function fetchLocalTransactions(): Promise<QuickTransaction[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.to_account_id as toAccountId, t.category, t.ref_id as refId, t.created_at as createdAt,
            a.name as accountName, a.type as accountType,
            a2.name as toAccountName, a2.type as toAccountType
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts a2 ON a2.id = t.to_account_id
     ORDER BY t.created_at DESC`,
  );
  const rows = result.rows;
  const list: QuickTransaction[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    list.push(toTransaction(rows.item(i)));
  }
  return list;
}

export async function createLocalAccount(payload: {
  name: string;
  type: Account['type'];
  balance: number;
}): Promise<Account> {
  const db = await getDb();
  const result = await db.executeSql(
    'INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)',
    [payload.name, payload.type, Number(payload.balance || 0)],
  );
  let insertId = result && result[0] ? result[0].insertId : undefined;
  if (!insertId || insertId <= 0) {
    try {
      const [lastRes] = await db.executeSql('SELECT last_insert_rowid() as id');
      if (lastRes && lastRes.rows.length > 0) {
        insertId = lastRes.rows.item(0).id;
      }
    } catch {}
  }

  if (insertId) {
    try {
      const [rowResult] = await db.executeSql('SELECT * FROM accounts WHERE id = ?', [insertId]);
      if (rowResult && rowResult.rows.length > 0) {
        return toAccount(rowResult.rows.item(0));
      }
    } catch {}
  }

  const [latest] = await db.executeSql('SELECT * FROM accounts ORDER BY id DESC LIMIT 1');
  if (latest && latest.rows.length > 0) {
    return toAccount(latest.rows.item(0));
  }

  return {
    id: String(insertId || Date.now()),
    name: payload.name,
    type: payload.type,
    balance: Number(payload.balance || 0),
  };
}

async function findAccountByIdOrName(
  db: SQLiteDatabase,
  accountId?: string,
  accountName?: string,
  accountType?: Account['type'],
): Promise<Account | null> {
  if (accountId) {
    const [result] = await db.executeSql('SELECT * FROM accounts WHERE id = ?', [accountId]);
    if (result.rows.length) {
      return toAccount(result.rows.item(0));
    }
  }
  if (accountName && accountType) {
    const [result] = await db.executeSql(
      'SELECT * FROM accounts WHERE LOWER(name) = LOWER(?) AND LOWER(type) = LOWER(?) LIMIT 1',
      [accountName.trim(), accountType.trim()],
    );
    if (result.rows.length) {
      return toAccount(result.rows.item(0));
    }
  }
  if (accountName) {
    const [result] = await db.executeSql(
      'SELECT * FROM accounts WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [accountName.trim()],
    );
    if (result.rows.length) {
      return toAccount(result.rows.item(0));
    }
  }
  return null;
}

export async function createLocalTransaction(payload: {
  type: QuickTransaction['type'];
  amount: number;
  note: string;
  accountId?: string;
  accountName?: string;
  accountType?: Account['type'];
  toAccountId?: string;
  toAccountName?: string;
  toAccountType?: Account['type'];
  createdAt?: string;
  category?: string;
  refId?: string;
  deduplicate?: boolean;
}): Promise<{ transaction: QuickTransaction; account?: Account; toAccount?: Account; isDuplicate?: boolean }> {
  const db = await getDb();
  let account = await findAccountByIdOrName(
    db,
    payload.accountId,
    payload.accountName,
    payload.accountType,
  );
  let toAccount = (payload.toAccountId || payload.toAccountName)
    ? await findAccountByIdOrName(
        db,
        payload.toAccountId,
        payload.toAccountName,
        payload.toAccountType,
      )
    : null;

  const cleanRefId = (payload.refId || '').trim();

  // 1. Permanent deduplication by Reference ID / Trx ID
  if (cleanRefId) {
    try {
      const [refExisting] = await db.executeSql(
        `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.to_account_id as toAccountId, t.category, t.ref_id as refId, t.created_at as createdAt,
                a.name as accountName, a.type as accountType,
                a2.name as toAccountName, a2.type as toAccountType
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN accounts a2 ON a2.id = t.to_account_id
         WHERE t.ref_id = ? LIMIT 1`,
        [cleanRefId],
      );
      if (refExisting && refExisting.rows.length > 0) {
        const row = refExisting.rows.item(0);
        console.log('[LocalDb] Duplicate transaction suppressed by permanent refId:', cleanRefId);
        const existingNote = (row.note || '').trim();
        const incomingNote = (payload.note || '').trim();
        if (incomingNote && incomingNote !== existingNote &&
            (existingNote.includes('Was Fast') || existingNote === 'Transfer to News' || existingNote === 'Bank Transfer' || !existingNote)) {
          await db.executeSql('UPDATE transactions SET note = ? WHERE id = ?', [incomingNote, row.id]);
          row.note = incomingNote;
        }
        return { transaction: toTransaction(row), account: account ?? undefined, toAccount: toAccount ?? undefined, isDuplicate: true };
      }
    } catch (e) {
      console.warn('[LocalDb] RefId deduplication query error:', e);
    }
  }

  // 2. Sliding window deduplication check (24-hour window)
  if (payload.deduplicate) {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const [existing] = await db.executeSql(
        `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.to_account_id as toAccountId, t.category, t.ref_id as refId, t.created_at as createdAt,
                a.name as accountName, a.type as accountType,
                a2.name as toAccountName, a2.type as toAccountType
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN accounts a2 ON a2.id = t.to_account_id
         WHERE t.type = ? AND ABS(t.amount - ?) < 0.01 AND t.created_at >= ?
         ORDER BY t.id DESC LIMIT 10`,
        [payload.type, payload.amount, windowStart],
      );
      if (existing && existing.rows.length > 0) {
        const payloadNote = (payload.note || '').trim().toLowerCase();
        const payloadAccount = (payload.accountName || '').trim().toLowerCase();
        const payloadTime = new Date(payload.createdAt || Date.now()).getTime();

        for (let i = 0; i < existing.rows.length; i++) {
          const row = existing.rows.item(i);
          const rowNote = (row.note || '').trim().toLowerCase();
          const rowAccount = (row.accountName || '').trim().toLowerCase();
          const rowTime = new Date(row.createdAt).getTime();
          const timeDiff = Math.abs(payloadTime - rowTime);

          const isNoteMatch = rowNote === payloadNote || (!rowNote && !payloadNote);
          const isSameAccount = rowAccount === payloadAccount || (!rowAccount && !payloadAccount) ||
                                rowAccount === 'bank account' || payloadAccount === 'bank account';
          const isTransferUpdate = (rowNote.includes('transfer') && payloadNote.includes('transfer')) ||
                                   (rowNote.includes('wise') && payloadNote.includes('wise')) ||
                                   (rowNote.includes('was fast') || payloadNote.includes('was fast')) ||
                                   (rowNote.includes('news') || payloadNote.includes('news'));

          if ((isNoteMatch && isSameAccount) || (isSameAccount && timeDiff < 4 * 3600 * 1000 && isTransferUpdate) || (timeDiff < 10 * 60 * 1000 && isSameAccount)) {
            console.log('[LocalDb] Duplicate transaction detected within 24h window, suppressing duplicate:', payload);
            const existingRawNote = (row.note || '').trim();
            const incomingRawNote = (payload.note || '').trim();
            if (incomingRawNote && incomingRawNote !== existingRawNote &&
                (existingRawNote.includes('Was Fast') || existingRawNote === 'Transfer to News' || !existingRawNote)) {
              await db.executeSql('UPDATE transactions SET note = ? WHERE id = ?', [incomingRawNote, row.id]);
              row.note = incomingRawNote;
            }
            return { transaction: toTransaction(row), account: account ?? undefined, toAccount: toAccount ?? undefined, isDuplicate: true };
          }
        }
      }
    } catch (e) {
      console.warn('[LocalDb] Deduplication query error:', e);
    }
  }

  if (!account && payload.accountName && payload.accountType) {
    const created = await createLocalAccount({
      name: payload.accountName,
      type: payload.accountType,
      balance: 0,
    });
    account = created;
  }

  if (!toAccount && payload.toAccountName && payload.toAccountType) {
    const created = await createLocalAccount({
      name: payload.toAccountName,
      type: payload.toAccountType,
      balance: 0,
    });
    toAccount = created;
  }

  const accountIdToUse = account ? account.id : (payload.accountId || null);
  const toAccountIdToUse = toAccount ? toAccount.id : (payload.toAccountId || null);
  const createdAt = payload.createdAt || new Date().toISOString();
  const result = await db.executeSql(
    'INSERT INTO transactions (type, amount, note, account_id, to_account_id, category, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      payload.type,
      payload.amount,
      payload.note || null,
      accountIdToUse,
      toAccountIdToUse,
      payload.category || null,
      cleanRefId || null,
      createdAt,
    ],
  );
  let insertId = result && result[0] ? result[0].insertId : undefined;
  if (!insertId || insertId <= 0) {
    try {
      const [lastRes] = await db.executeSql('SELECT last_insert_rowid() as id');
      if (lastRes && lastRes.rows.length > 0) {
        insertId = lastRes.rows.item(0).id;
      }
    } catch {}
  }

  if (payload.type === 'transfer') {
    if (account) {
      const nextSourceBalance = Number(account.balance) - Number(payload.amount);
      await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextSourceBalance, account.id]);
      account = { ...account, balance: nextSourceBalance };
    }
    if (toAccount) {
      const nextDestBalance = Number(toAccount.balance) + Number(payload.amount);
      await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextDestBalance, toAccount.id]);
      toAccount = { ...toAccount, balance: nextDestBalance };
    }
  } else if (account) {
    const delta = payload.type === 'income' ? Number(payload.amount) : -Number(payload.amount);
    const nextBalance = Number(account.balance) + delta;
    await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, account.id]);
    account = { ...account, balance: nextBalance };
  }

  let rowResult: any = null;
  if (insertId) {
    try {
      const [res] = await db.executeSql(
        `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.to_account_id as toAccountId, t.category, t.created_at as createdAt,
                a.name as accountName, a.type as accountType,
                a2.name as toAccountName, a2.type as toAccountType
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN accounts a2 ON a2.id = t.to_account_id
         WHERE t.id = ?`,
        [insertId],
      );
      if (res && res.rows.length > 0) {
        rowResult = res;
      }
    } catch {}
  }

  if (!rowResult) {
    try {
      const [latest] = await db.executeSql(
        `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.to_account_id as toAccountId, t.category, t.created_at as createdAt,
                a.name as accountName, a.type as accountType,
                a2.name as toAccountName, a2.type as toAccountType
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN accounts a2 ON a2.id = t.to_account_id
         ORDER BY t.id DESC LIMIT 1`,
      );
      if (latest && latest.rows.length > 0) {
        rowResult = latest;
      }
    } catch {}
  }

  if (rowResult && rowResult.rows.length > 0) {
    return {
      transaction: toTransaction(rowResult.rows.item(0)),
      account: account ?? undefined,
      toAccount: toAccount ?? undefined,
    };
  }

  return {
    transaction: {
      id: String(insertId || Date.now()),
      type: payload.type,
      amount: payload.amount,
      note: payload.note,
      accountId: accountIdToUse ? String(accountIdToUse) : undefined,
      accountName: account?.name,
      accountType: account?.type,
      toAccountId: toAccountIdToUse ? String(toAccountIdToUse) : undefined,
      toAccountName: toAccount?.name,
      toAccountType: toAccount?.type,
      category: payload.category,
      createdAt,
    },
    account: account ?? undefined,
    toAccount: toAccount ?? undefined,
  };
}

export async function updateLocalTransaction(
  id: string,
  payload: {
    type: QuickTransaction['type'];
    amount: number;
    note: string;
    accountId?: string;
    accountName?: string;
    accountType?: Account['type'];
    createdAt?: string;
    category?: string;
  },
): Promise<{ transaction: QuickTransaction; accounts: Account[] }> {
  const db = await getDb();
  const [existingResult] = await db.executeSql('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!existingResult.rows.length) {
    throw new Error('Transaction not found');
  }
  const existing = existingResult.rows.item(0);

  const oldAccountId = existing.account_id ? String(existing.account_id) : undefined;
  const oldAccount = oldAccountId
    ? await findAccountByIdOrName(db, oldAccountId)
    : null;

  let newAccount = await findAccountByIdOrName(
    db,
    payload.accountId,
    payload.accountName,
    payload.accountType,
  );
  if (!newAccount && payload.accountName && payload.accountType) {
    newAccount = await createLocalAccount({
      name: payload.accountName,
      type: payload.accountType,
      balance: 0,
    });
  }

  const nextAccountId = newAccount ? newAccount.id : null;
  await db.executeSql(
    'UPDATE transactions SET type = ?, amount = ?, note = ?, account_id = ?, category = ?, created_at = ? WHERE id = ?',
    [
      payload.type,
      payload.amount,
      payload.note || null,
      nextAccountId,
      payload.category || null,
      payload.createdAt || existing.created_at,
      id,
    ],
  );

  const oldDelta = existing.type === 'income'
    ? Number(existing.amount)
    : -Number(existing.amount);
  const newDelta = payload.type === 'income'
    ? Number(payload.amount)
    : -Number(payload.amount);

  const updatedAccounts: Account[] = [];
  if (oldAccount && newAccount && oldAccount.id === newAccount.id) {
    const nextBalance = Number(oldAccount.balance) - oldDelta + newDelta;
    await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, oldAccount.id]);
    updatedAccounts.push({ ...oldAccount, balance: nextBalance });
  } else {
    if (oldAccount) {
      const nextBalance = Number(oldAccount.balance) - oldDelta;
      await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, oldAccount.id]);
      updatedAccounts.push({ ...oldAccount, balance: nextBalance });
    }
    if (newAccount) {
      const nextBalance = Number(newAccount.balance) + newDelta;
      await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, newAccount.id]);
      updatedAccounts.push({ ...newAccount, balance: nextBalance });
    }
  }

  const [rowResult] = await db.executeSql(
    `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.to_account_id as toAccountId, t.category, t.created_at as createdAt,
            a.name as accountName, a.type as accountType,
            a2.name as toAccountName, a2.type as toAccountType
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts a2 ON a2.id = t.to_account_id
     WHERE t.id = ?`,
    [id],
  );

  return {
    transaction: toTransaction(rowResult.rows.item(0)),
    accounts: updatedAccounts,
  };
}

export async function deleteLocalTransaction(
  id: string,
): Promise<{ account?: Account; toAccount?: Account }> {
  const db = await getDb();
  const [existingResult] = await db.executeSql(
    'SELECT * FROM transactions WHERE id = ?',
    [id],
  );
  if (!existingResult.rows.length) {
    return {};
  }
  const existing = existingResult.rows.item(0);
  const accountId = existing.account_id ? String(existing.account_id) : undefined;
  const toAccountId = existing.to_account_id ? String(existing.to_account_id) : undefined;
  const account = accountId ? await findAccountByIdOrName(db, accountId) : null;
  const destAccount = toAccountId ? await findAccountByIdOrName(db, toAccountId) : null;

  if (existing.type === 'transfer') {
    if (account) {
      const nextBalance = Number(account.balance) + Number(existing.amount);
      await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, account.id]);
    }
    if (destAccount) {
      const nextDestBalance = Number(destAccount.balance) - Number(existing.amount);
      await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextDestBalance, destAccount.id]);
    }
  } else if (account) {
    const delta = existing.type === 'income'
      ? -Number(existing.amount)
      : Number(existing.amount);
    const nextBalance = Number(account.balance) + delta;
    await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, account.id]);
  }

  await db.executeSql('DELETE FROM transactions WHERE id = ?', [id]);

  let updatedSource: Account | undefined;
  let updatedDest: Account | undefined;
  if (account) {
    const [rowResult] = await db.executeSql('SELECT * FROM accounts WHERE id = ?', [account.id]);
    if (rowResult.rows.length) {
      updatedSource = toAccount(rowResult.rows.item(0));
    }
  }
  if (destAccount) {
    const [rowResult] = await db.executeSql('SELECT * FROM accounts WHERE id = ?', [destAccount.id]);
    if (rowResult.rows.length) {
      updatedDest = toAccount(rowResult.rows.item(0));
    }
  }
  return { account: updatedSource, toAccount: updatedDest };
}

export async function updateLocalAccount(
  id: string,
  payload: {
    name: string;
    type: Account['type'];
    balance: number;
  },
): Promise<Account> {
  const db = await getDb();
  await db.executeSql(
    'UPDATE accounts SET name = ?, type = ?, balance = ? WHERE id = ?',
    [payload.name, payload.type, Number(payload.balance || 0), id],
  );
  const [rowResult] = await db.executeSql('SELECT * FROM accounts WHERE id = ?', [id]);
  return toAccount(rowResult.rows.item(0));
}

export async function deleteLocalAccount(
  id: string,
): Promise<{ accountId: string; transactionIds: string[] }> {
  const db = await getDb();
  const [transactionResult] = await db.executeSql(
    'SELECT id FROM transactions WHERE account_id = ? OR to_account_id = ?',
    [id, id],
  );
  const transactionIds: string[] = [];
  for (let i = 0; i < transactionResult.rows.length; i += 1) {
    transactionIds.push(String(transactionResult.rows.item(i).id));
  }
  await db.executeSql('DELETE FROM transactions WHERE account_id = ? OR to_account_id = ?', [id, id]);
  await db.executeSql('DELETE FROM accounts WHERE id = ?', [id]);
  return { accountId: id, transactionIds };
}

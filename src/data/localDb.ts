import SQLite from 'react-native-sqlite-storage';
import { Account, QuickTransaction } from './models';

SQLite.enablePromise(true);

type SQLiteDatabase = any;

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabase({ name: 'fiscus.db', location: 'default' });
  }
  return dbPromise;
}

export async function initLocalDb(): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`,
  );
  await db.executeSql(
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
  );
  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );`,
  );
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
  category: row.category || undefined,
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
    `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.category, t.created_at as createdAt,
            a.name as accountName, a.type as accountType
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
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
  const insertId = result[0].insertId;
  const [rowResult] = await db.executeSql('SELECT * FROM accounts WHERE id = ?', [insertId]);
  return toAccount(rowResult.rows.item(0));
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
      'SELECT * FROM accounts WHERE name = ? AND type = ? LIMIT 1',
      [accountName, accountType],
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
  createdAt?: string;
  category?: string;
}): Promise<{ transaction: QuickTransaction; account?: Account }> {
  const db = await getDb();
  let account = await findAccountByIdOrName(
    db,
    payload.accountId,
    payload.accountName,
    payload.accountType,
  );
  if (!account && payload.accountName && payload.accountType) {
    const created = await createLocalAccount({
      name: payload.accountName,
      type: payload.accountType,
      balance: 0,
    });
    account = created;
  }

  const accountIdToUse = account ? account.id : null;
  const createdAt = payload.createdAt || new Date().toISOString();
  const result = await db.executeSql(
    'INSERT INTO transactions (type, amount, note, account_id, category, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      payload.type,
      payload.amount,
      payload.note || null,
      accountIdToUse,
      payload.category || null,
      createdAt,
    ],
  );
  const insertId = result[0].insertId;

  if (account) {
    const delta = payload.type === 'income' ? Number(payload.amount) : -Number(payload.amount);
    const nextBalance = Number(account.balance) + delta;
    await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, account.id]);
    account = { ...account, balance: nextBalance };
  }

  const [rowResult] = await db.executeSql(
    `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.category, t.created_at as createdAt,
            a.name as accountName, a.type as accountType
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.id = ?`,
    [insertId],
  );

  return {
    transaction: toTransaction(rowResult.rows.item(0)),
    account: account ?? undefined,
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
    `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.category, t.created_at as createdAt,
            a.name as accountName, a.type as accountType
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
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
): Promise<{ account?: Account }> {
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
  const account = accountId ? await findAccountByIdOrName(db, accountId) : null;

  if (account) {
    const delta = existing.type === 'income'
      ? -Number(existing.amount)
      : Number(existing.amount);
    const nextBalance = Number(account.balance) + delta;
    await db.executeSql('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, account.id]);
  }

  await db.executeSql('DELETE FROM transactions WHERE id = ?', [id]);

  if (account) {
    const [rowResult] = await db.executeSql('SELECT * FROM accounts WHERE id = ?', [account.id]);
    if (rowResult.rows.length) {
      return { account: toAccount(rowResult.rows.item(0)) };
    }
  }
  return {};
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
    'SELECT id FROM transactions WHERE account_id = ?',
    [id],
  );
  const transactionIds: string[] = [];
  for (let i = 0; i < transactionResult.rows.length; i += 1) {
    transactionIds.push(String(transactionResult.rows.item(i).id));
  }
  await db.executeSql('DELETE FROM transactions WHERE account_id = ?', [id]);
  await db.executeSql('DELETE FROM accounts WHERE id = ?', [id]);
  return { accountId: id, transactionIds };
}

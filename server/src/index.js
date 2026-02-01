require('dotenv').config();
const express = require('express');
const { initDb } = require('./db');

const app = express();
app.use(express.json());

let db;
initDb()
  .then(instance => {
    db = instance;
  })
  .catch(error => {
    console.error('Failed to initialize SQLite DB', error);
    process.exit(1);
  });

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/accounts', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM accounts ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load accounts' });
  }
});

app.get('/transactions', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT t.id, t.type, t.amount, t.note, t.account_id as accountId, t.category, t.created_at as createdAt,
              a.name as accountName, a.type as accountType
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       ORDER BY t.created_at DESC`
    );
    res.json(
      rows.map(row => ({
        id: String(row.id),
        type: row.type,
        amount: Number(row.amount),
        note: row.note || '',
        createdAt: row.createdAt,
        accountId: row.accountId ? String(row.accountId) : undefined,
        accountName: row.accountName || undefined,
        accountType: row.accountType || undefined,
        category: row.category || undefined,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

app.post('/accounts', async (req, res) => {
  const { name, type, balance } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: 'Missing name or type' });
  }
  try {
    const result = await db.run(
      'INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)',
      [name, type, Number(balance || 0)],
    );
    const row = await db.get('SELECT * FROM accounts WHERE id = ?', [result.lastID]);
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/transactions', async (req, res) => {
  const { type, amount, note, accountId, accountName, accountType, createdAt, category } = req.body;
  if (!type || !amount) {
    return res.status(400).json({ error: 'Missing type or amount' });
  }
  try {
    let account = null;
    if (accountId) {
      account = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
    } else if (accountName && accountType) {
      account = await db.get(
        'SELECT * FROM accounts WHERE name = ? AND type = ?',
        [accountName, accountType],
      );
    }

    if (!account && accountName && accountType) {
      const insert = await db.run(
        'INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)',
        [accountName, accountType, 0],
      );
      account = await db.get('SELECT * FROM accounts WHERE id = ?', [insert.lastID]);
    }

    const accountIdToUse = account ? account.id : null;
    const result = await db.run(
      'INSERT INTO transactions (type, amount, note, account_id, category, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        type,
        amount,
        note || null,
        accountIdToUse,
        category || null,
        createdAt || new Date().toISOString(),
      ],
    );

    if (account) {
      const delta = type === 'income' ? Number(amount) : -Number(amount);
      const nextBalance = Number(account.balance) + delta;
      await db.run('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, account.id]);
      account = await db.get('SELECT * FROM accounts WHERE id = ?', [account.id]);
    }

    res.json({
      transaction: {
        id: String(result.lastID),
        type,
        amount: Number(amount),
        note: note || '',
        createdAt: createdAt || new Date().toISOString(),
        accountId: account ? String(account.id) : undefined,
        accountName: account ? account.name : accountName,
        accountType: account ? account.type : accountType,
        category: category || undefined,
      },
      account,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

app.put('/transactions/:id', async (req, res) => {
  const { id } = req.params;
  const { type, amount, note, accountId, accountName, accountType, createdAt, category } = req.body;
  if (!type || !amount) {
    return res.status(400).json({ error: 'Missing type or amount' });
  }

  try {
    const existing = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    let oldAccount = null;
    if (existing.account_id) {
      oldAccount = await db.get('SELECT * FROM accounts WHERE id = ?', [existing.account_id]);
    }

    let newAccount = null;
    if (accountId) {
      newAccount = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
    } else if (accountName && accountType) {
      newAccount = await db.get(
        'SELECT * FROM accounts WHERE name = ? AND type = ?',
        [accountName, accountType],
      );
    }

    if (!newAccount && accountName && accountType) {
      const insert = await db.run(
        'INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)',
        [accountName, accountType, 0],
      );
      newAccount = await db.get('SELECT * FROM accounts WHERE id = ?', [insert.lastID]);
    }

    const nextAccountId = newAccount ? newAccount.id : null;
    await db.run(
      'UPDATE transactions SET type = ?, amount = ?, note = ?, account_id = ?, category = ?, created_at = ? WHERE id = ?',
      [
        type,
        amount,
        note || null,
        nextAccountId,
        category || null,
        createdAt || existing.created_at,
        id,
      ],
    );

    const oldDelta = existing.type === 'income' ? Number(existing.amount) : -Number(existing.amount);
    const newDelta = type === 'income' ? Number(amount) : -Number(amount);

    const updatedAccounts = [];
    if (oldAccount && newAccount && oldAccount.id === newAccount.id) {
      const nextBalance = Number(oldAccount.balance) - oldDelta + newDelta;
      await db.run('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, oldAccount.id]);
      updatedAccounts.push(await db.get('SELECT * FROM accounts WHERE id = ?', [oldAccount.id]));
    } else {
      if (oldAccount) {
        const nextBalance = Number(oldAccount.balance) - oldDelta;
        await db.run('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, oldAccount.id]);
        updatedAccounts.push(await db.get('SELECT * FROM accounts WHERE id = ?', [oldAccount.id]));
      }
      if (newAccount) {
        const nextBalance = Number(newAccount.balance) + newDelta;
        await db.run('UPDATE accounts SET balance = ? WHERE id = ?', [nextBalance, newAccount.id]);
        updatedAccounts.push(await db.get('SELECT * FROM accounts WHERE id = ?', [newAccount.id]));
      }
    }

    res.json({
      transaction: {
        id: String(id),
        type,
        amount: Number(amount),
        note: note || '',
        createdAt: createdAt || existing.created_at,
        accountId: newAccount ? String(newAccount.id) : undefined,
        accountName: newAccount ? newAccount.name : accountName,
        accountType: newAccount ? newAccount.type : accountType,
        category: category || undefined,
      },
      accounts: updatedAccounts,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Fiscus server running on port ${port}`);
});

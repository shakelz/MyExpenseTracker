const path = require('path');
const fs = require('fs');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const DEFAULT_DB_FILE = path.join(__dirname, '..', 'data', 'fiscus.db');

const schema = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT NULL,
  account_id INTEGER NULL,
  category TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
`;

async function initDb() {
  const dbFile = process.env.SQLITE_FILE || DEFAULT_DB_FILE;
  const dir = path.dirname(dbFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = await open({ filename: dbFile, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(schema);
  return db;
}

module.exports = { initDb };

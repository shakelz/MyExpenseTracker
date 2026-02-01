import { API_BASE_URL } from '../config';
import { Account, QuickTransaction } from './models';

type CreateAccountPayload = {
  name: string;
  type: Account['type'];
  balance: number;
};

type CreateTransactionPayload = {
  type: QuickTransaction['type'];
  amount: number;
  note: string;
  accountId?: string;
  accountName?: string;
  accountType?: Account['type'];
  createdAt?: string;
  category?: string;
};

export async function fetchAccounts(): Promise<Account[]> {
  const response = await fetch(`${API_BASE_URL}/accounts`);
  if (!response.ok) {
    throw new Error('Failed to load accounts');
  }
  return response.json();
}

export async function fetchTransactions(): Promise<QuickTransaction[]> {
  const response = await fetch(`${API_BASE_URL}/transactions`);
  if (!response.ok) {
    throw new Error('Failed to load transactions');
  }
  return response.json();
}

export async function createAccount(payload: CreateAccountPayload): Promise<Account> {
  const response = await fetch(`${API_BASE_URL}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to create account');
  }
  return response.json();
}

export async function createTransaction(
  payload: CreateTransactionPayload,
): Promise<{ transaction: QuickTransaction; account: Account }> {
  const response = await fetch(`${API_BASE_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to create transaction');
  }
  return response.json();
}

export async function updateTransaction(
  id: string,
  payload: CreateTransactionPayload,
): Promise<{ transaction: QuickTransaction; accounts: Account[] }> {
  const response = await fetch(`${API_BASE_URL}/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to update transaction');
  }
  return response.json();
}

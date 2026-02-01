export type AccountType = 'bank' | 'cash' | 'wallet';

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
};

export type TransactionType = 'income' | 'expense';

export type QuickTransaction = {
  id: string;
  type: TransactionType;
  amount: number;
  note: string;
  createdAt: string;
  accountId?: string;
  accountName?: string;
  accountType?: AccountType;
  category?: string;
};

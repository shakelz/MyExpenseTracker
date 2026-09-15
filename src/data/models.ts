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

export type DebtType = 'lent' | 'borrowed'; // lent = Lena Hai, borrowed = Dena Hai
export type DebtStatus = 'pending' | 'partially_paid' | 'settled';

export type Debt = {
  id: string;
  personName: string;
  phone?: string;
  type: DebtType;
  amount: number;
  remainingAmount: number;
  note?: string;
  dueDate?: string;
  status: DebtStatus;
  createdAt: string;
  updatedAt: string;
};

export type DebtTransaction = {
  id: string;
  debtId: string;
  amount: number;
  note?: string;
  type: 'repayment' | 'additional';
  createdAt: string;
};

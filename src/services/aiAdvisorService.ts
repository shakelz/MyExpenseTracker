import { Account, Debt, QuickTransaction, TransactionType } from '../data/models';

export type FinancialHealthReport = {
  score: number;
  status: 'Excellent' | 'Good' | 'Fair' | 'Critical';
  statusColor: string;
  savingsRate: number;
  dailyBurnRate: number;
  projectedMonthExpense: number;
  totalLiquidBalance: number;
  currentMonthIncome: number;
  currentMonthExpense: number;
  netSavings: number;
  debtExposure: number;
  insights: Array<{
    id: string;
    type: 'positive' | 'warning' | 'info' | 'tip';
    icon: string;
    title: string;
    description: string;
  }>;
};

export type AIParsedTransaction = {
  amount: number;
  type: 'expense' | 'income';
  category: string;
  note: string;
  accountId: string | null;
  accountName: string | null;
  date: string;
  rawText: string;
};

// Keyword mapping for real-time AI Category prediction
const EXPENSE_CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Food & Dining': [
    'food', 'restaurant', 'cafe', 'coffee', 'starbucks', 'dinner', 'lunch',
    'breakfast', 'burger', 'pizza', 'mcdonalds', 'kfc', 'swiggy', 'zomato',
    'cheezious', 'subway', 'bakery', 'tea', 'chai', 'snacks', 'drinks',
    'takeout', 'dining', 'bistro', 'bar', 'hotel', 'biryani', 'shawarma', 'kitchen'
  ],
  'Groceries': [
    'grocery', 'groceries', 'supermarket', 'mart', 'veggies', 'vegetables',
    'fruits', 'milk', 'bread', 'hyperstar', 'carrefour', 'dmart', 'pantry',
    'provision', 'meat', 'chicken', 'eggs', 'eggs', 'bazaar', 'store', 'market'
  ],
  'Transportation': [
    'uber', 'careem', 'lyft', 'taxi', 'cab', 'petrol', 'fuel', 'diesel',
    'pso', 'shell', 'total', 'cng', 'train', 'metro', 'bus', 'ticket',
    'parking', 'toll', 'flight', 'airline', 'transit', 'indrive', 'yango', 'ride'
  ],
  'Shopping': [
    'clothes', 'apparel', 'amazon', 'daraz', 'flipkart', 'mall', 'shoes',
    'zara', 'h&m', 'outfit', 'electronics', 'gadget', 'purchase', 'shopping',
    'dress', 'fashion', 'cosmetics', 'perfume', 'accessories'
  ],
  'Entertainment': [
    'netflix', 'spotify', 'youtube', 'prime', 'disney', 'movie', 'cinema',
    'theatre', 'game', 'gaming', 'steam', 'playstation', 'xbox', 'concert',
    'party', 'event', 'subscription', 'streaming'
  ],
  'Bills & Utilities': [
    'electricity', 'electric', 'water', 'gas', 'internet', 'wifi', 'phone',
    'mobile', 'bill', 'recharge', 'utility', 'kelectric', 'lesco', 'ptcl',
    'rent', 'maintenance', 'broadband', 'cellular', 'recharge'
  ],
  'Health': [
    'medicine', 'pharmacy', 'doctor', 'hospital', 'clinic', 'lab', 'test',
    'dentist', 'health', 'medical', 'pills', 'consultation', 'therapy',
    'physio', 'vitamins', 'supplement'
  ],
  'Education': [
    'fee', 'tuition', 'school', 'college', 'university', 'books', 'course',
    'udemy', 'coursera', 'training', 'classes', 'exam', 'admission'
  ],
};

const INCOME_CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Salary': [
    'salary', 'payroll', 'wages', 'stipend', 'bonus', 'payout', 'remuneration',
    'company credit', 'employer'
  ],
  'Business': [
    'client', 'freelance', 'invoice', 'project', 'profit', 'sales', 'contract',
    'revenue', 'stripe', 'upwork', 'fiverr', 'paypal', 'consulting', 'customer'
  ],
  'Investments': [
    'dividend', 'stocks', 'profit', 'crypto', 'interest', 'mutual fund',
    'shares', 'yield', 'trading', 'binance', 'etf'
  ],
  'Gifts': [
    'gift', 'cash gift', 'prize', 'reward', 'cashback', 'refund', 'eidi', 'present'
  ],
};

/**
 * Predicts the most appropriate category using lightweight NLP heuristic.
 */
export function predictCategory(
  note: string,
  type: TransactionType = 'expense',
): string | null {
  if (!note || note.trim().length === 0) return null;
  if (type === 'transfer') return 'Transfer';
  const lower = note.toLowerCase();

  const dict = type === 'expense' ? EXPENSE_CATEGORY_KEYWORDS : INCOME_CATEGORY_KEYWORDS;

  for (const [category, keywords] of Object.entries(dict)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return category;
      }
    }
  }

  return null;
}

/**
 * Calculates a 360-degree Financial Health Score (0-100) and actionable insights.
 */
export function calculateFinancialHealth(
  transactions: QuickTransaction[],
  accounts: Account[],
  debts: Debt[],
  currencySymbol: string = '€',
): FinancialHealthReport {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const dayOfMonth = now.getDate();
  const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // 1. Calculate Liquid Balance
  const totalLiquidBalance = accounts.reduce(
    (sum, a) => sum + (Number(a.balance) || 0),
    0,
  );

  // 2. Filter this month's transactions (strictly excluding internal transfers from expense outflow)
  let currentMonthIncome = 0;
  let currentMonthExpense = 0;
  let currentMonthTransfers = 0;
  const categorySpendMap: Record<string, number> = {};

  transactions.forEach(t => {
    const d = new Date(t.createdAt);
    if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
      const amt = Number(t.amount) || 0;
      if (t.type === 'income') {
        currentMonthIncome += amt;
      } else if (t.type === 'expense') {
        currentMonthExpense += amt;
        const cat = t.category || 'General';
        categorySpendMap[cat] = (categorySpendMap[cat] || 0) + amt;
      } else if (t.type === 'transfer') {
        currentMonthTransfers += amt;
      }
    }
  });

  const netSavings = currentMonthIncome - currentMonthExpense;
  const savingsRate =
    currentMonthIncome > 0
      ? Math.max(-100, Math.min(100, Math.round((netSavings / currentMonthIncome) * 100)))
      : currentMonthExpense > 0
      ? -100
      : 0;

  const dailyBurnRate = dayOfMonth > 0 ? currentMonthExpense / dayOfMonth : 0;
  const projectedMonthExpense = dailyBurnRate * totalDaysInMonth;

  // 3. Khata / Debt exposure
  const totalPendingToPay = debts
    .filter(d => d.type === 'borrowed' || (d as any).type === 'payable' || (d as any).type === 'debt')
    .reduce((sum, d) => sum + (d.remainingAmount !== undefined ? Number(d.remainingAmount) : Math.max(0, (Number(d.amount) || 0) - (Number((d as any).paidAmount) || 0))), 0);

  const totalPendingToReceive = debts
    .filter(d => d.type === 'lent' || (d as any).type === 'receivable' || (d as any).type === 'credit')
    .reduce((sum, d) => sum + (d.remainingAmount !== undefined ? Number(d.remainingAmount) : Math.max(0, (Number(d.amount) || 0) - (Number((d as any).paidAmount) || 0))), 0);

  const debtExposure = totalLiquidBalance > 0
    ? Math.round((totalPendingToPay / totalLiquidBalance) * 100)
    : totalPendingToPay > 0 ? 100 : 0;

  // 4. Calculate Sub-Scores (Total 100)
  // Component A: Savings Rate (0 - 35 points)
  let savingsScore = 15;
  if (savingsRate >= 40) savingsScore = 35;
  else if (savingsRate >= 25) savingsScore = 30;
  else if (savingsRate >= 15) savingsScore = 24;
  else if (savingsRate >= 0) savingsScore = 18;
  else if (savingsRate >= -25) savingsScore = 10;
  else savingsScore = 5;

  // Component B: Burn Velocity vs Income (0 - 30 points)
  let burnScore = 20;
  if (currentMonthIncome > 0) {
    const expenseRatio = projectedMonthExpense / currentMonthIncome;
    if (expenseRatio <= 0.6) burnScore = 30;
    else if (expenseRatio <= 0.8) burnScore = 24;
    else if (expenseRatio <= 1.0) burnScore = 18;
    else if (expenseRatio <= 1.3) burnScore = 10;
    else burnScore = 4;
  } else if (currentMonthExpense === 0) {
    burnScore = 25;
  } else {
    burnScore = 12;
  }

  // Component C: Debt / Khata Health (0 - 20 points)
  let debtScore = 18;
  if (totalPendingToPay === 0) {
    debtScore = 20;
  } else if (debtExposure <= 15) {
    debtScore = 17;
  } else if (debtExposure <= 40) {
    debtScore = 13;
  } else if (debtExposure <= 80) {
    debtScore = 8;
  } else {
    debtScore = 4;
  }

  // Component D: Liquidity Buffer (0 - 15 points)
  let liquidityScore = 10;
  const monthBaseline = Math.max(currentMonthExpense, 100);
  const runwayMonths = totalLiquidBalance / monthBaseline;
  if (runwayMonths >= 3) liquidityScore = 15;
  else if (runwayMonths >= 1.5) liquidityScore = 12;
  else if (runwayMonths >= 0.8) liquidityScore = 9;
  else if (runwayMonths > 0) liquidityScore = 5;
  else liquidityScore = 2;

  const totalScore = Math.min(100, Math.max(10, Math.round(savingsScore + burnScore + debtScore + liquidityScore)));

  let status: FinancialHealthReport['status'] = 'Good';
  let statusColor = '#38B2AC';
  if (totalScore >= 80) {
    status = 'Excellent';
    statusColor = '#48BB78';
  } else if (totalScore >= 65) {
    status = 'Good';
    statusColor = '#4E7CFF';
  } else if (totalScore >= 45) {
    status = 'Fair';
    statusColor = '#ECC94B';
  } else {
    status = 'Critical';
    statusColor = '#F56565';
  }

  // 5. Generate Contextual AI Insights
  const insights: FinancialHealthReport['insights'] = [];

  // A. Duplicate Transaction Detection (Look for identical expenses within 24 hours)
  const recentExpenses = transactions
    .filter(t => t.type === 'expense')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  for (let i = 0; i < recentExpenses.length - 1; i++) {
    const a = recentExpenses[i];
    const b = recentExpenses[i + 1];
    const timeDiff = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const within24h = timeDiff < 24 * 60 * 60 * 1000;
    if (within24h && Math.abs(Number(a.amount) - Number(b.amount)) < 0.01 && (a.category === b.category || a.note === b.note)) {
      insights.push({
        id: 'dup-alert',
        type: 'warning',
        icon: '⚠️',
        title: 'Potential Duplicate Charge',
        description: `Found 2 identical charges of ${currencySymbol}${Number(a.amount).toLocaleString()} (${a.category || 'Expense'}) within 24 hours. Verify if this was debited twice.`,
      });
      break;
    }
  }

  // B. Top spending category insight
  const sortedCategories = Object.entries(categorySpendMap).sort((a, b) => b[1] - a[1]);
  if (sortedCategories.length > 0 && currentMonthExpense > 0) {
    const [topCat, topAmt] = sortedCategories[0];
    const catPercent = Math.round((topAmt / currentMonthExpense) * 100);
    insights.push({
      id: 'top-cat',
      type: catPercent > 40 ? 'warning' : 'info',
      icon: catPercent > 40 ? '⚠️' : '📊',
      title: `Top Outflow: ${topCat} (${catPercent}%)`,
      description: `${topCat} makes up ${catPercent}% of this month's outflows (${currencySymbol}${Math.round(topAmt).toLocaleString()} spent). Consider setting a weekly budget.`,
    });
  }

  // C. High Single-Expense Anomaly Alert
  if (currentMonthExpense > 100) {
    const monthlyExpenses = transactions.filter(t => {
      const d = new Date(t.createdAt);
      return t.type === 'expense' && d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    }).sort((a, b) => Number(b.amount) - Number(a.amount));

    if (monthlyExpenses.length > 0 && Number(monthlyExpenses[0].amount) / currentMonthExpense >= 0.35) {
      const highest = monthlyExpenses[0];
      const pct = Math.round((Number(highest.amount) / currentMonthExpense) * 100);
      insights.push({
        id: 'anomaly-high-spend',
        type: 'info',
        icon: '🔍',
        title: `Major Single Expense (${pct}%)`,
        description: `Single outflow of ${currencySymbol}${Number(highest.amount).toLocaleString()} for "${highest.note || highest.category}" accounts for ${pct}% of total outflows this month.`,
      });
    }
  }

  // D. Spending Burn rate projection
  if (currentMonthIncome > 0 && projectedMonthExpense > currentMonthIncome) {
    const deficit = Math.round(projectedMonthExpense - currentMonthIncome);
    insights.push({
      id: 'burn-deficit',
      type: 'warning',
      icon: '🚨',
      title: 'Projected Budget Overrun',
      description: `At your current pace of ${currencySymbol}${Math.round(dailyBurnRate).toLocaleString()}/day, you're on track to overspend by ${currencySymbol}${deficit.toLocaleString()} by month end.`,
    });
  } else if (savingsRate >= 25) {
    insights.push({
      id: 'savings-pro',
      type: 'positive',
      icon: '✨',
      title: `Strong ${savingsRate}% Savings Rate`,
      description: `You are retaining ${savingsRate}% of your earnings this month. Great discipline maintaining financial runway!`,
    });
  }

  // E. Khata receivables / collection insight
  if (totalPendingToReceive > 0) {
    insights.push({
      id: 'khata-receive',
      type: 'info',
      icon: '🤝',
      title: 'Pending Khata Collections',
      description: `You have ${currencySymbol}${Math.round(totalPendingToReceive).toLocaleString()} pending to collect from your contacts. Following up will boost your liquid buffer.`,
    });
  }

  // F. Internal Transfers insight
  if (currentMonthTransfers > 0) {
    insights.push({
      id: 'transfers-volume',
      type: 'info',
      icon: '🔁',
      title: 'Internal Transfers',
      description: `You moved ${currencySymbol}${Math.round(currentMonthTransfers).toLocaleString()} between accounts this month. Internal transfers do not reduce your net savings.`,
    });
  }

  // F. General actionable tip
  if (insights.length < 3) {
    insights.push({
      id: 'smart-tip',
      type: 'tip',
      icon: '💡',
      title: 'Emergency Reserve Rule',
      description: `Maintain at least 3 months of basic living expenses in high-security bank or cash accounts for peace of mind.`,
    });
  }

  return {
    score: totalScore,
    status,
    statusColor,
    savingsRate,
    dailyBurnRate: Math.round(dailyBurnRate),
    projectedMonthExpense: Math.round(projectedMonthExpense),
    totalLiquidBalance,
    currentMonthIncome,
    currentMonthExpense,
    netSavings,
    debtExposure,
    insights,
  };
}

/**
 * AI Smart Parser: Extracts structured transaction data from raw bank SMS / receipt text.
 */
export function parseBankAlertOrReceiptWithAI(
  rawText: string,
  accounts: Account[],
): AIParsedTransaction {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // 1. Detect Type (Income vs Expense)
  let type: 'expense' | 'income' = 'expense';
  const incomeKeywords = [
    'credited', 'received', 'deposit', 'income', 'salary', 'cashback',
    'refund', 'added to', 'credit alert', 'funds received', 'transferred to your'
  ];
  const expenseKeywords = [
    'debited', 'paid', 'sent', 'spent', 'withdrawn', 'purchase',
    'deducted', 'payment to', 'debit alert', 'transfer to', 'ibft'
  ];

  let isIncome = incomeKeywords.some(kw => lower.includes(kw));
  let isExpense = expenseKeywords.some(kw => lower.includes(kw));

  if (isIncome && !isExpense) {
    type = 'income';
  } else {
    type = 'expense';
  }

  // 2. Extract Amount
  // Clean masked account numbers like **1234 or a/c 12345 to prevent false matches
  const textForAmount = text
    .replace(/(?:acct|account|a\/c|card|ending)\s*[*x#\d]{3,16}/gi, ' ')
    .replace(/\*{2,}\d+/g, ' ');

  let amount = 0;
  const amountPatterns = [
    /(?:rs\.?|pkr|inr|usd|\$|eur|€|gbp|£|aed|sar)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|pkr|inr|usd|\$|eur|€|gbp|£|aed|sar)/i,
    /(?:amount|amt|sum|for|of|paid)\s*(?::|\s)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/,
  ];

  for (const regex of amountPatterns) {
    const match = textForAmount.match(regex);
    if (match && match[1]) {
      const parsedNum = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsedNum) && parsedNum > 0 && parsedNum < 10_000_000) {
        amount = parsedNum;
        break;
      }
    }
  }

  // 3. Match Account
  let matchedAccountId: string | null = null;
  let matchedAccountName: string | null = null;

  for (const acc of accounts) {
    const accNameLower = acc.name.toLowerCase();
    if (lower.includes(accNameLower)) {
      matchedAccountId = acc.id;
      matchedAccountName = acc.name;
      break;
    }
  }

  // Bank name keywords if not directly matched by name
  if (!matchedAccountId) {
    const bankKeywords = [
      'meezan', 'hbl', 'easypaisa', 'jazzcash', 'sadapay', 'nayapay',
      'alfalah', 'ubl', 'mcb', 'standard chartered', 'deutsche bank', 'revolut', 'chase',
      'wise', 'paypal', 'cash'
    ];
    for (const bank of bankKeywords) {
      if (lower.includes(bank)) {
        const found = accounts.find(a => a.name.toLowerCase().includes(bank));
        if (found) {
          matchedAccountId = found.id;
          matchedAccountName = found.name;
          break;
        } else {
          matchedAccountName = bank.toUpperCase();
        }
      }
    }
  }

  if (!matchedAccountId && accounts.length > 0) {
    matchedAccountId = accounts[0].id;
    matchedAccountName = accounts[0].name;
  }

  // 4. Extract Clean Note & Merchant
  let note = '';
  const merchantPatterns = [
    /(?:paid to|sent to|at)\s+([A-Za-z0-9\s&'-]{3,35})(?:\s+on|\s+via|\.|,|$)/i,
    /(?:from|received from)\s+([A-Za-z0-9\s&'-]{3,35})(?:\s+on|\s+via|\.|,|$)/i,
    /(?:to)\s+([A-Za-z0-9\s&'-]{3,35})(?:\s+on|\s+via|\.|,|$)/i,
    /(?:for)\s+([A-Za-z0-9\s&'-]{3,35})(?:\s+on|\s+via|\.|,|$)/i,
  ];

  for (const pattern of merchantPatterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const candidate = m[1].trim();
      const lowerCand = candidate.toLowerCase();
      if (
        !lowerCand.includes('account') &&
        !lowerCand.includes('acct') &&
        !lowerCand.startsWith('rs') &&
        !lowerCand.startsWith('pkr') &&
        !lowerCand.startsWith('usd') &&
        !lowerCand.startsWith('eur') &&
        !lowerCand.startsWith('inr')
      ) {
        note = candidate;
        break;
      }
    }
  }

  if (!note) {
    note = text.replace(/[\r\n]+/g, ' ').substring(0, 45).trim();
  }

  // 5. Predict Category
  const category = predictCategory(text, type) || (type === 'income' ? 'Salary' : 'General');

  return {
    amount,
    type,
    category,
    note,
    accountId: matchedAccountId,
    accountName: matchedAccountName,
    date: new Date().toISOString(),
    rawText: text,
  };
}

/**
 * Ask Fiscus AI Copilot: Interactive Financial Assistant
 */
export function queryFinancialAI(
  query: string,
  transactions: QuickTransaction[],
  accounts: Account[],
  debts: Debt[],
  currencySymbol: string,
): string {
  const q = query.toLowerCase().trim();
  const format = (n: number) => `${currencySymbol}${Math.abs(Math.round(n)).toLocaleString()}`;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const totalLiquid = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);

  // Month stats (strictly excluding internal transfers from expense outflow)
  let monthExpense = 0;
  let monthIncome = 0;
  let monthTransfers = 0;
  const categoryMap: Record<string, number> = {};

  // Week stats (last 7 days)
  let weekExpense = 0;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  transactions.forEach(t => {
    const d = new Date(t.createdAt);
    const amt = Number(t.amount) || 0;

    if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
      if (t.type === 'income') {
        monthIncome += amt;
      } else if (t.type === 'expense') {
        monthExpense += amt;
        const cat = t.category || 'General';
        categoryMap[cat] = (categoryMap[cat] || 0) + amt;
      } else if (t.type === 'transfer') {
        monthTransfers += amt;
      }
    }

    if (d >= sevenDaysAgo && t.type === 'expense') {
      weekExpense += amt;
    }
  });

  const sortedCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  const topCategory = sortedCategories.length > 0 ? sortedCategories[0] : null;

  // Khata stats
  const totalReceivable = debts
    .filter(d => d.type === 'lent' || (d as any).type === 'receivable' || (d as any).type === 'credit')
    .reduce((s, d) => s + (d.remainingAmount !== undefined ? Number(d.remainingAmount) : Math.max(0, (Number(d.amount) || 0) - (Number((d as any).paidAmount) || 0))), 0);

  const totalPayable = debts
    .filter(d => d.type === 'borrowed' || (d as any).type === 'payable' || (d as any).type === 'debt')
    .reduce((s, d) => s + (d.remainingAmount !== undefined ? Number(d.remainingAmount) : Math.max(0, (Number(d.amount) || 0) - (Number((d as any).paidAmount) || 0))), 0);

  // 1. Affordability query check: "can i afford 500", "afford €100", "afford to buy 250", etc.
  const affordMatch =
    q.match(/afford(?:ability)?(?:\s+(?:to\s+buy|to\s+spend|a|an))?\s*(?:rs\.?|pkr|inr|usd|\$|eur|€|gbp|£|aed|sar)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
    q.match(/afford(?:ability)?(?:\s+(?:to\s+buy|to\s+spend|a|an))?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|pkr|inr|usd|\$|eur|€|gbp|£|aed|sar)?/i);

  if (affordMatch && affordMatch[1]) {
    const cost = parseFloat(affordMatch[1].replace(/,/g, ''));
    if (!isNaN(cost) && cost > 0) {
      const remainingAfter = totalLiquid - cost;
      if (cost > totalLiquid) {
        return `❌ **Not recommended right now.**\n\nYour total liquid balance across all accounts is **${format(totalLiquid)}**. Spending **${format(cost)}** would exceed your available funds by **${format(cost - totalLiquid)}**.`;
      } else if (remainingAfter < totalLiquid * 0.3) {
        return `⚠️ **Exercise Caution.**\n\nYou have **${format(totalLiquid)}** in liquid funds. Purchasing **${format(cost)}** will leave only **${format(remainingAfter)}** (${Math.round((remainingAfter / totalLiquid) * 100)}% of your buffer). If this is non-essential, consider postponing.`;
      } else {
        return `✅ **Yes, comfortably affordable!**\n\nYou have **${format(totalLiquid)}** available across your accounts. After spending **${format(cost)}**, you will still retain **${format(remainingAfter)}** in liquid reserves.`;
      }
    }
  }

  // 2. Transfers query
  if (q.includes('transfer')) {
    return `🔄 **Internal Account Transfers:**\n\nYou have transferred **${format(monthTransfers)}** between your accounts this month.\n\nInternal transfers are properly excluded from your expense outflows so your savings and burn rate remain 100% accurate!`;
  }

  // 3. Duplicate / Anomaly check query
  if (q.includes('duplicate') || q.includes('anomaly') || q.includes('double')) {
    const recentExp = transactions.filter(t => t.type === 'expense').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    let dupFound = false;
    for (let i = 0; i < recentExp.length - 1; i++) {
      const a = recentExp[i];
      const b = recentExp[i + 1];
      const timeDiff = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (timeDiff < 24 * 60 * 60 * 1000 && Math.abs(Number(a.amount) - Number(b.amount)) < 0.01) {
        dupFound = true;
        return `⚠️ **Potential Duplicate Found:**\n\nIdentified 2 identical charges of **${format(Number(a.amount))}** (${a.category || 'Expense'}) within 24 hours of each other.\n\nPlease check your recent transactions list to ensure you weren't double charged!`;
      }
    }
    if (!dupFound) {
      return `✅ **No Duplicate Transactions Detected.**\n\nYour transaction stream is clean. No suspicious identical charges found within the same 24-hour windows.`;
    }
  }

  // 4. Week spending query
  if (q.includes('week') || q.includes('recent') || q.includes('7 days')) {
    return `📅 **Last 7 Days Spending:**\n\nYou have spent **${format(weekExpense)}** over the past week.\n\nYour average daily outflow over the week is approx **${format(weekExpense / 7)}/day**. Keep an eye on discretionary spending!`;
  }

  // 5. Month spending query
  if (q.includes('month') || q.includes('spent') || q.includes('how much')) {
    const net = monthIncome - monthExpense;
    return `📊 **This Month's Financial Summary:**\n\n• **Total Income:** ${format(monthIncome)}\n• **Total Expenses:** ${format(monthExpense)}\n• **Net Savings:** ${net >= 0 ? '+' : ''}${format(net)}\n\n${topCategory ? `Your highest expense category is **${topCategory[0]}** (${format(topCategory[1])}).` : ''}`;
  }

  // 6. Top category query
  if (q.includes('top') || q.includes('biggest') || q.includes('category') || q.includes('most')) {
    if (!topCategory) {
      return `ℹ️ You don't have enough categorized expenses recorded for this month yet. Start logging expenses to get deep AI breakdowns!`;
    }
    const pct = monthExpense > 0 ? Math.round((topCategory[1] / monthExpense) * 100) : 0;
    return `🏆 **Biggest Outflow Category:**\n\n**${topCategory[0]}** is your highest expense, totaling **${format(topCategory[1])}** (${pct}% of all spending this month).\n\n💡 *AI Recommendation:* Trimming just 10% from ${topCategory[0]} would save you **${format(topCategory[1] * 0.1)}** each month!`;
  }

  // 7. Khata / Debts query
  if (q.includes('khata') || q.includes('debt') || q.includes('owe') || q.includes('loan')) {
    return `🤝 **Khata & Loan Portfolio:**\n\n• **To Collect (You are owed):** ${format(totalReceivable)}\n• **To Repay (You owe):** ${format(totalPayable)}\n• **Net Khata Balance:** ${totalReceivable >= totalPayable ? '+' : ''}${format(totalReceivable - totalPayable)}\n\n${totalReceivable > 0 ? `Tip: Sending friendly reminders for the ${format(totalReceivable)} pending can instantly increase your liquid funds.` : 'Your khata debt exposure is well contained!'}`;
  }

  // 8. Savings / tips query
  if (q.includes('save') || q.includes('tip') || q.includes('advice') || q.includes('invest')) {
    const savingsRate = monthIncome > 0 ? Math.round(((monthIncome - monthExpense) / monthIncome) * 100) : 0;
    return `💡 **Fiscus AI Smart Financial Advice:**\n\n1. **50/30/20 Rule:** Your current savings rate is **${savingsRate}%**. Aim to allocate 50% to needs, 30% to wants, and 20% directly into savings/investments.\n2. **Liquid Emergency Buffer:** Keep at least 3 months of basic outflows in your primary bank account.\n3. **Khata Discipline:** Always log repayments immediately to maintain healthy relationships and accurate ledgers.`;
  }

  // Fallback intelligent answer
  return `🤖 **Fiscus Financial Overview:**\n\n• **Liquid Net Worth:** ${format(totalLiquid)} across ${accounts.length} accounts\n• **Monthly Outflows:** ${format(monthExpense)}\n• **Pending Khata:** ${format(totalReceivable)} to receive, ${format(totalPayable)} to pay.\n\nYou can ask me specific questions like:\n• *"Can I afford €150?"*\n• *"How much did I spend this week?"*\n• *"What is my biggest expense?"*\n• *"Analyze my Khata debts"*`;
}

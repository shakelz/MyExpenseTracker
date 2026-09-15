import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Account, QuickTransaction } from '../data/models';

type AnalysisScreenProps = {
  transactions: QuickTransaction[];
  accounts: Account[];
  currencySymbol: string;
  onBack: () => void;
};

const getMonthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

const monthLabel = (index: number, withYear = false) => {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return new Date(year, month, 1).toLocaleString('en-GB',
    withYear ? { month: 'short', year: 'numeric' } : { month: 'short' },
  );
};

export default function AnalysisScreen({
  transactions,
  accounts,
  currencySymbol,
  onBack,
}: AnalysisScreenProps) {
  const safeAreaInsets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const today = useMemo(() => new Date(), []);
  const baseMonthIndex = useMemo(() => getMonthIndex(today), [today]);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(baseMonthIndex);

  const formatCurrency = (value: number) =>
    `${currencySymbol}${Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;

  // Month options (last 6 months)
  const monthOptions = useMemo(() => {
    const count = 6;
    return Array.from({ length: count }, (_, idx) => baseMonthIndex - (count - 1 - idx));
  }, [baseMonthIndex]);

  // Statistics calculation
  const stats = useMemo(() => {
    const currentMonthIndex = selectedMonthIndex;
    const previousMonthIndex = selectedMonthIndex - 1;

    let income = 0;
    let expense = 0;
    let prevIncome = 0;
    let prevExpense = 0;

    const categoryMap: Record<string, number> = {};
    const accountSpendMap: Record<string, number> = {};
    const currentMonthTxs: QuickTransaction[] = [];

    const year = Math.floor(currentMonthIndex / 12);
    const month = currentMonthIndex % 12;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Day-by-day spending to find top spending day and velocity
    const daySpendMap: Record<number, number> = {};

    transactions.forEach(t => {
      const d = new Date(t.createdAt);
      const mIdx = getMonthIndex(d);

      if (mIdx === currentMonthIndex) {
        currentMonthTxs.push(t);
        const day = d.getDate();
        if (t.type === 'income') {
          income += t.amount;
        } else {
          expense += t.amount;
          daySpendMap[day] = (daySpendMap[day] || 0) + t.amount;

          const cat = t.category?.trim() || 'Other';
          categoryMap[cat] = (categoryMap[cat] || 0) + t.amount;

          const accName = t.accountName?.trim() || 'Unassigned';
          accountSpendMap[accName] = (accountSpendMap[accName] || 0) + t.amount;
        }
      } else if (mIdx === previousMonthIndex) {
        if (t.type === 'income') {
          prevIncome += t.amount;
        } else {
          prevExpense += t.amount;
        }
      }
    });

    const netSavings = income - expense;
    const savingsRate = income > 0 ? Math.max(0, Math.min(100, (netSavings / income) * 100)) : 0;

    // Daily average spend & projected month-end
    const isCurrentCalendarMonth = currentMonthIndex === baseMonthIndex;
    const daysElapsed = isCurrentCalendarMonth ? Math.max(1, today.getDate()) : daysInMonth;
    const dailyAverage = expense / daysElapsed;
    const projectedMonthEnd = isCurrentCalendarMonth ? dailyAverage * daysInMonth : expense;

    // Top spending day
    let peakDay = 1;
    let peakDayAmount = 0;
    Object.entries(daySpendMap).forEach(([dayStr, amt]) => {
      if (amt > peakDayAmount) {
        peakDayAmount = amt;
        peakDay = parseInt(dayStr, 10);
      }
    });

    // Month-over-month expense change %
    const expenseChangePct =
      prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : null;

    // Categories sorted by highest spend
    const sortedCategories = Object.entries(categoryMap)
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: expense > 0 ? Math.round((amount / expense) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Top 5 largest single expenses
    const topExpenses = currentMonthTxs
      .filter(t => t.type === 'expense')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Account spending list
    const sortedAccounts = Object.entries(accountSpendMap)
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: expense > 0 ? Math.round((amount / expense) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      income,
      expense,
      prevExpense,
      netSavings,
      savingsRate,
      dailyAverage,
      projectedMonthEnd,
      peakDay,
      peakDayAmount,
      expenseChangePct,
      sortedCategories,
      topExpenses,
      sortedAccounts,
      daysInMonth,
      daysElapsed,
    };
  }, [baseMonthIndex, selectedMonthIndex, today, transactions]);

  const getCategoryEmoji = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('food') || lower.includes('groc') || lower.includes('eat')) return '🛒';
    if (lower.includes('bill') || lower.includes('util')) return '⚡';
    if (lower.includes('shop') || lower.includes('cloth')) return '🛍️';
    if (lower.includes('travel') || lower.includes('fuel') || lower.includes('ride')) return '🚗';
    if (lower.includes('health') || lower.includes('med')) return '💊';
    if (lower.includes('fun') || lower.includes('entertain')) return '🎬';
    if (lower.includes('salary') || lower.includes('work')) return '💼';
    return '💳';
  };

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header Bar */}
        <View style={[styles.headerWrap, { paddingTop: safeAreaInsets.top + 14 }]}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>Financial Insights</Text>
              <Text style={styles.headerSubtitle}>Real-time Analytics & Spending Health</Text>
            </View>
            <Pressable style={styles.backBtn} onPress={onBack}>
              <Text style={styles.backBtnText}>✕ Close</Text>
            </Pressable>
          </View>

          {/* Month Selector Carousel */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.monthScroll}
          >
            {monthOptions.map(idx => {
              const isSelected = idx === selectedMonthIndex;
              return (
                <Pressable
                  key={idx}
                  style={[styles.monthPill, isSelected && styles.monthPillActive]}
                  onPress={() => setSelectedMonthIndex(idx)}
                >
                  <Text style={[styles.monthPillText, isSelected && styles.monthPillTextActive]}>
                    {monthLabel(idx, true)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* 1. Cashflow & Savings Card (Revolut / CRED Style) */}
        <View style={styles.cashflowCard}>
          <View style={styles.cashflowHeader}>
            <Text style={styles.cardSectionTag}>MONTHLY CASHFLOW</Text>
            {stats.expenseChangePct !== null && (
              <View
                style={[
                  styles.changeBadge,
                  {
                    backgroundColor:
                      stats.expenseChangePct > 0
                        ? 'rgba(239, 68, 68, 0.15)'
                        : 'rgba(16, 185, 129, 0.15)',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.changeBadgeText,
                    { color: stats.expenseChangePct > 0 ? '#F87171' : '#34D399' },
                  ]}
                >
                  {stats.expenseChangePct > 0 ? '↑' : '↓'}{' '}
                  {Math.abs(Math.round(stats.expenseChangePct))}% vs last month
                </Text>
              </View>
            )}
          </View>

          <View style={styles.netSavingsBlock}>
            <Text style={styles.netSavingsLabel}>Net Savings</Text>
            <Text
              style={[
                styles.netSavingsAmount,
                { color: stats.netSavings >= 0 ? '#34D399' : '#F87171' },
              ]}
            >
              {stats.netSavings >= 0 ? '+' : '-'}
              {formatCurrency(stats.netSavings)}
            </Text>
          </View>

          {/* Inflow vs Outflow Dual Columns */}
          <View style={styles.inflowOutflowRow}>
            <View style={styles.inflowCol}>
              <View style={styles.flowIconBadgeIncome}>
                <Text style={{ fontSize: 11, color: '#34D399', fontWeight: '800' }}>↓ IN</Text>
              </View>
              <Text style={styles.flowLabel}>Total Inflow</Text>
              <Text style={styles.flowAmountIncome}>{formatCurrency(stats.income)}</Text>
            </View>

            <View style={styles.flowDivider} />

            <View style={styles.outflowCol}>
              <View style={styles.flowIconBadgeExpense}>
                <Text style={{ fontSize: 11, color: '#F87171', fontWeight: '800' }}>↑ OUT</Text>
              </View>
              <Text style={styles.flowLabel}>Total Outflow</Text>
              <Text style={styles.flowAmountExpense}>{formatCurrency(stats.expense)}</Text>
            </View>
          </View>

          {/* Savings Rate Progress Meter */}
          <View style={styles.savingsMeterWrap}>
            <View style={styles.savingsMeterHeader}>
              <Text style={styles.savingsMeterLabel}>Savings Rate</Text>
              <Text style={styles.savingsMeterValue}>{Math.round(stats.savingsRate)}%</Text>
            </View>
            <View style={styles.savingsBarBg}>
              <View
                style={[
                  styles.savingsBarFill,
                  {
                    width: `${Math.round(stats.savingsRate)}%`,
                    backgroundColor: stats.savingsRate >= 30 ? '#10B981' : stats.savingsRate > 10 ? '#F59E0B' : '#EF4444',
                  },
                ]}
              />
            </View>
            <Text style={styles.savingsAdviceText}>
              {stats.savingsRate >= 40
                ? '🌟 Excellent financial discipline! You are saving over 40%.'
                : stats.savingsRate >= 20
                ? '👍 Good savings rate. Aim for 30%+ for long-term wealth.'
                : '⚠️ Caution: High expense ratio. Review top category leaks.'}
            </Text>
          </View>
        </View>

        {/* 2. Spending Velocity & Projections */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Spending Velocity & Burn Rate</Text>
          <View style={styles.velocityGrid}>
            <View style={styles.velocityCard}>
              <Text style={styles.velocityLabel}>Daily Average</Text>
              <Text style={styles.velocityValue}>{formatCurrency(stats.dailyAverage)}</Text>
              <Text style={styles.velocitySub}>per day ({stats.daysElapsed} days)</Text>
            </View>

            <View style={styles.velocityCard}>
              <Text style={styles.velocityLabel}>Projected Month End</Text>
              <Text style={styles.velocityValue}>{formatCurrency(stats.projectedMonthEnd)}</Text>
              <Text style={styles.velocitySub}>at current burn rate</Text>
            </View>
          </View>

          {stats.peakDayAmount > 0 && (
            <View style={styles.peakDayAlert}>
              <Text style={styles.peakDayIcon}>🔥</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.peakDayTitle}>Peak Spending Day: Day {stats.peakDay}</Text>
                <Text style={styles.peakDayDesc}>
                  You spent {formatCurrency(stats.peakDayAmount)} on this single day.
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* 3. Category Breakdown with Visual Bars */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Category Breakdown</Text>
            <Text style={styles.sectionHeaderCount}>
              {stats.sortedCategories.length} categories
            </Text>
          </View>

          {stats.sortedCategories.length === 0 ? (
            <View style={styles.emptyCategories}>
              <Text style={styles.emptyCategoriesText}>No expenses recorded for this month.</Text>
            </View>
          ) : (
            stats.sortedCategories.map(cat => (
              <View key={cat.name} style={styles.categoryItem}>
                <View style={styles.categoryTopRow}>
                  <View style={styles.categoryNameBadge}>
                    <Text style={styles.categoryEmoji}>{getCategoryEmoji(cat.name)}</Text>
                    <Text style={styles.categoryNameText}>{cat.name}</Text>
                  </View>
                  <View style={styles.categoryAmountBlock}>
                    <Text style={styles.categoryAmountText}>{formatCurrency(cat.amount)}</Text>
                    <Text style={styles.categoryPercentText}>{cat.percentage}%</Text>
                  </View>
                </View>

                {/* Percentage progress bar */}
                <View style={styles.categoryBarBg}>
                  <View
                    style={[
                      styles.categoryBarFill,
                      { width: `${cat.percentage}%` },
                    ]}
                  />
                </View>
              </View>
            ))
          )}
        </View>

        {/* 4. Top Single Expenses */}
        {stats.topExpenses.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Top Single Expenses</Text>
            <Text style={styles.sectionSubtitle}>Highest individual transactions this month</Text>
            {stats.topExpenses.map((t, idx) => (
              <View key={t.id} style={styles.topExpenseRow}>
                <View style={styles.topExpenseRank}>
                  <Text style={styles.topExpenseRankText}>#{idx + 1}</Text>
                </View>
                <View style={styles.topExpenseInfo}>
                  <Text style={styles.topExpenseNote}>{t.note || t.category || 'Expense'}</Text>
                  <Text style={styles.topExpenseMeta}>
                    {new Date(t.createdAt).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                    })}
                    {t.accountName ? ` · ${t.accountName}` : ''}
                  </Text>
                </View>
                <Text style={styles.topExpenseAmount}>-{formatCurrency(t.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 5. Account Activity Distribution */}
        {stats.sortedAccounts.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Spending By Account</Text>
            <View style={styles.accountsGrid}>
              {stats.sortedAccounts.map(acc => (
                <View key={acc.name} style={styles.accountSpendCard}>
                  <Text style={styles.accountSpendName}>{acc.name}</Text>
                  <Text style={styles.accountSpendAmount}>{formatCurrency(acc.amount)}</Text>
                  <Text style={styles.accountSpendPercent}>{acc.percentage}% of total outflow</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B1B3A',
  },
  scrollContent: {
    paddingBottom: 120,
  },
  headerWrap: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  backBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  monthScroll: {
    gap: 8,
  },
  monthPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  monthPillActive: {
    backgroundColor: '#6EE7B7',
  },
  monthPillText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  monthPillTextActive: {
    color: '#1B1B3A',
    fontWeight: '700',
  },
  cashflowCard: {
    marginHorizontal: 20,
    backgroundColor: '#20224A',
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cashflowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardSectionTag: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1,
  },
  changeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  netSavingsBlock: {
    marginBottom: 16,
  },
  netSavingsLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.65)',
    fontWeight: '600',
  },
  netSavingsAmount: {
    fontSize: 28,
    fontWeight: '800',
    marginTop: 2,
  },
  inflowOutflowRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  inflowCol: {
    flex: 1,
  },
  outflowCol: {
    flex: 1,
  },
  flowDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 12,
  },
  flowIconBadgeIncome: {
    width: 48,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 2,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 6,
  },
  flowIconBadgeExpense: {
    width: 48,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingVertical: 2,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 6,
  },
  flowLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  flowAmountIncome: {
    fontSize: 16,
    fontWeight: '700',
    color: '#34D399',
    marginTop: 2,
  },
  flowAmountExpense: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F87171',
    marginTop: 2,
  },
  savingsMeterWrap: {
    marginTop: 4,
  },
  savingsMeterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  savingsMeterLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  savingsMeterValue: {
    fontSize: 13,
    color: '#6EE7B7',
    fontWeight: '800',
  },
  savingsBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  savingsBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  savingsAdviceText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 8,
    lineHeight: 15,
  },
  sectionContainer: {
    marginHorizontal: 20,
    backgroundColor: '#20224A',
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionHeaderCount: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  velocityGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  velocityCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 12,
  },
  velocityLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  velocityValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
  },
  velocitySub: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 2,
  },
  peakDayAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  peakDayIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  peakDayTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FCD34D',
  },
  peakDayDesc: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 1,
  },
  categoryItem: {
    marginBottom: 12,
  },
  categoryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  categoryNameBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryEmoji: {
    fontSize: 16,
    marginRight: 8,
  },
  categoryNameText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  categoryAmountBlock: {
    alignItems: 'flex-end',
  },
  categoryAmountText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  categoryPercentText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  categoryBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  categoryBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#6EE7B7',
  },
  emptyCategories: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyCategoriesText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  topExpenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  topExpenseRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  topExpenseRankText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  topExpenseInfo: {
    flex: 1,
  },
  topExpenseNote: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  topExpenseMeta: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 1,
  },
  topExpenseAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F87171',
  },
  accountsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  accountSpendCard: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 10,
  },
  accountSpendName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  accountSpendAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6EE7B7',
    marginTop: 4,
  },
  accountSpendPercent: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.45)',
    marginTop: 2,
  },
});

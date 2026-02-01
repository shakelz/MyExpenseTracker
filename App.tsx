/**
 * Expense tracker quick add UI
 * @format
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  FlatList,
  Linking,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import QuickTransactionSheet from './src/components/QuickTransactionSheet';
import AccountSheet from './src/components/AccountSheet';
import { Account, QuickTransaction } from './src/data/models';
import AnalysisScreen from './src/screens/AnalysisScreen';
import SettingsScreen, { CountryOption } from './src/screens/SettingsScreen';
import {
  checkOverlayPermission,
  clearPendingBubbleTransactions,
  getPendingBubbleTransactions,
  hideSystemBubble,
  initializeSystemBubble,
  requestOverlayPermission,
  setBubbleOptions,
  setBubbleCurrencySymbol,
  showSystemBubble,
  stopSystemBubble,
} from './src/platform/bubbleService';
import {
  createLocalAccount,
  createLocalTransaction,
  fetchLocalAccounts,
  fetchLocalTransactions,
  initLocalDb,
  seedLocalDataIfEmpty,
  updateLocalTransaction,
} from './src/data/localDb';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './src/data/categories';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [isQuickAddOpen, setQuickAddOpen] = useState(false);
  const [isAccountOpen, setAccountOpen] = useState(false);
  const [transactions, setTransactions] = useState<QuickTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeScreen, setActiveScreen] = useState<
    'home' | 'analysis' | 'settings'
  >('home');
  const [editingTransaction, setEditingTransaction] = useState<
    QuickTransaction | null
  >(null);
  const [hasOverlayPermission, setHasOverlayPermission] = useState(false);
  const [bubbleEnabled, setBubbleEnabled] = useState(false);

  const countries: CountryOption[] = useMemo(
    () => [
      { name: 'United States', code: 'US', currencySymbol: '$' },
      { name: 'United Kingdom', code: 'GB', currencySymbol: '£' },
      { name: 'Eurozone', code: 'EU', currencySymbol: '€' },
      { name: 'India', code: 'IN', currencySymbol: '₹' },
      { name: 'Japan', code: 'JP', currencySymbol: '¥' },
      { name: 'United Arab Emirates', code: 'AE', currencySymbol: 'د.إ' },
    ],
    [],
  );
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(
    countries[0],
  );
  const currencySymbol = selectedCountry.currencySymbol;

  const getMonthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
  const currentMonthIndex = useMemo(
    () => getMonthIndex(new Date()),
    [transactions],
  );
  const currentMonthTransactions = useMemo(
    () =>
      transactions.filter(item =>
        getMonthIndex(new Date(item.createdAt)) === currentMonthIndex,
      ),
    [currentMonthIndex, transactions],
  );

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      const granted = await requestOverlayPermission();
      if (isMounted) {
        setHasOverlayPermission(granted);
        setBubbleEnabled(granted);
      }
      if (granted) {
        await initializeSystemBubble();
        await hideSystemBubble();
      }
      const pending = await getPendingBubbleTransactions();
      if (pending && pending !== '[]') {
        try {
          const items = JSON.parse(pending) as QuickTransaction[];
          mergePendingTransactions(items);
          await clearPendingBubbleTransactions();
        } catch {
          // ignore parse errors
        }
      }
    };
    bootstrap();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleUrl = (url?: string | null) => {
      if (!url) return;
      if (url.startsWith('fiscus://quick-add')) {
        setQuickAddOpen(true);
        return;
      }
      if (url.startsWith('fiscus://add-account')) {
        setAccountOpen(true);
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', event => {
      handleUrl(event.url);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const categories = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
    const bankWalletAccounts = accounts
      .filter(account => account.type !== 'cash')
      .map(account => ({
        name: account.name,
        type: account.type,
        balance: account.balance,
      }));
    setBubbleOptions(categories, bankWalletAccounts);
  }, [accounts]);

  useEffect(() => {
    setBubbleCurrencySymbol(currencySymbol);
  }, [currencySymbol]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async state => {
      if (state === 'active') {
        await initializeSystemBubble();
        await hideSystemBubble();
        const pending = await getPendingBubbleTransactions();
        if (pending && pending !== '[]') {
          try {
            const items = JSON.parse(pending) as QuickTransaction[];
            mergePendingTransactions(items);
            await clearPendingBubbleTransactions();
          } catch {
            // ignore parse errors
          }
        }
        return;
      }
      const granted = await checkOverlayPermission();
      setHasOverlayPermission(granted);
      if (granted && bubbleEnabled) {
        await showSystemBubble(width - 84, height * 0.5);
      } else {
        await hideSystemBubble();
      }
    });

    return () => subscription.remove();
  }, [bubbleEnabled, hasOverlayPermission, height, width]);

  useEffect(() => {
    initLocalDb()
      .then(async () => {
        await seedLocalDataIfEmpty();
        const [accountList, transactionList] = await Promise.all([
          fetchLocalAccounts(),
          fetchLocalTransactions(),
        ]);
        setAccounts(accountList);
        setTransactions(transactionList);
      })
      .catch(() => null);
  }, []);

  const summary = useMemo(() => {
    return currentMonthTransactions.reduce(
      (acc, item) => {
        if (item.type === 'income') {
          acc.income += item.amount;
        } else {
          acc.expense += item.amount;
        }
        return acc;
      },
      { income: 0, expense: 0 },
    );
  }, [currentMonthTransactions]);

  const formatCurrency = (value: number) =>
    `${currencySymbol}${value.toFixed(2)}`;

  const handleToggleBubble = async (next: boolean) => {
    if (next) {
      const granted = await requestOverlayPermission();
      setHasOverlayPermission(granted);
      if (!granted) {
        setBubbleEnabled(false);
        return;
      }
      await initializeSystemBubble();
      await setBubbleCurrencySymbol(currencySymbol);
      await showSystemBubble(width - 84, height * 0.5);
      setBubbleEnabled(true);
    } else {
      setBubbleEnabled(false);
      await hideSystemBubble();
      await stopSystemBubble();
    }
  };

  const mergePendingTransactions = async (items: QuickTransaction[]) => {
    setTransactions(current => [...items, ...current]);
    setAccounts(current => {
      let updated = [...current];
      items.forEach(item => {
        const accountName = item.accountName?.trim();
        const accountType = item.accountType;
        if (!accountName || !accountType) {
          return;
        }
        let account = updated.find(
          candidate =>
            candidate.name.toLowerCase() === accountName.toLowerCase() &&
            candidate.type === accountType,
        );
        if (!account) {
          account = {
            id: `acc-${Date.now()}-${Math.random()}`,
            name: accountName,
            type: accountType,
            balance: 0,
          };
          updated = [account, ...updated];
        }
        const delta = item.type === 'income' ? item.amount : -item.amount;
        account.balance += delta;
      });
      return updated;
    });
    for (const item of items) {
      try {
        const result = await createLocalTransaction({
          type: item.type,
          amount: item.amount,
          note: item.note,
          accountId: item.accountId,
          accountName: item.accountName,
          accountType: item.accountType,
          createdAt: item.createdAt,
          category: item.category,
        });
        setTransactions(current =>
          current.map(entry =>
            entry.id === item.id ? result.transaction : entry,
          ),
        );
        if (result.account) {
          setAccounts(current =>
            current.map(entry =>
              entry.id === result.account!.id ? result.account! : entry,
            ),
          );
        }
      } catch {
        // ignore local sync errors
      }
    }
  };

  const findAccountIdByDetails = (
    list: Account[],
    name?: string,
    type?: Account['type'],
  ) => {
    if (!name || !type) return undefined;
    return list.find(
      account =>
        account.name.toLowerCase() === name.toLowerCase() &&
        account.type === type,
    )?.id;
  };

  const handleAddAccount = async (account: Account) => {
    setAccounts(current => [account, ...current]);
    try {
      const created = await createLocalAccount({
        name: account.name,
        type: account.type,
        balance: account.balance,
      });
      setAccounts(current =>
        current.map(item => (item.id === account.id ? created : item)),
      );
    } catch {
      // keep local entry
    }
  };

  const handleSubmitTransaction = async (entry: QuickTransaction) => {
    setTransactions(current => {
      if (editingTransaction) {
        return current.map(item => (item.id === entry.id ? entry : item));
      }
      return [entry, ...current];
    });

    setAccounts(current => {
      let updated = [...current];
      const previous = editingTransaction;
      const applyDelta = (accountId: string, delta: number) => {
        updated = updated.map(account =>
          account.id === accountId
            ? { ...account, balance: account.balance + delta }
            : account,
        );
      };

      if (previous) {
        const prevDelta =
          previous.type === 'income' ? previous.amount : -previous.amount;
        const prevAccountId =
          previous.accountId ??
          findAccountIdByDetails(updated, previous.accountName, previous.accountType);
        if (prevAccountId) {
          applyDelta(prevAccountId, -prevDelta);
        }
      }

      const nextDelta = entry.type === 'income' ? entry.amount : -entry.amount;
      const nextAccountId =
        entry.accountId ??
        findAccountIdByDetails(updated, entry.accountName, entry.accountType);
      if (nextAccountId) {
        applyDelta(nextAccountId, nextDelta);
      }
      return updated;
    });

    try {
      if (editingTransaction) {
        const result = await updateLocalTransaction(entry.id, {
          type: entry.type,
          amount: entry.amount,
          note: entry.note,
          accountId: entry.accountId,
          accountName: entry.accountName,
          accountType: entry.accountType,
          createdAt: entry.createdAt,
          category: entry.category,
        });
        setTransactions(current =>
          current.map(item =>
            item.id === entry.id ? result.transaction : item,
          ),
        );
        setAccounts(current => {
          let next = [...current];
          result.accounts.forEach(account => {
            next = next.map(item => (item.id === account.id ? account : item));
          });
          return next;
        });
      } else {
        const result = await createLocalTransaction({
          type: entry.type,
          amount: entry.amount,
          note: entry.note,
          accountId: entry.accountId,
          accountName: entry.accountName,
          accountType: entry.accountType,
          createdAt: entry.createdAt,
          category: entry.category,
        });
        setTransactions(current =>
          current.map(item =>
            item.id === entry.id ? result.transaction : item,
          ),
        );
        if (result.account) {
          setAccounts(current =>
            current.map(item =>
              item.id === result.account!.id ? result.account! : item,
            ),
          );
        }
      }
    } catch {
      // keep local entry
    }
    setEditingTransaction(null);
  };

  return (
    <View style={styles.container}>
      {activeScreen === 'analysis' ? (
        <AnalysisScreen
          transactions={transactions}
          accounts={accounts}
          currencySymbol={currencySymbol}
          onBack={() => setActiveScreen('home')}
        />
      ) : activeScreen === 'settings' ? (
        <SettingsScreen
          countries={countries}
          selectedCountry={selectedCountry}
          onSelectCountry={setSelectedCountry}
          bubbleEnabled={bubbleEnabled}
          onToggleBubble={handleToggleBubble}
        />
      ) : (
        <>
          <FlatList
            data={currentMonthTransactions}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View>
                <View
                  style={[
                    styles.headerWrap,
                    { paddingTop: safeAreaInsets.top + 14 },
                  ]}
                >
                  <View style={styles.headerRow}>
                    <View style={styles.headerTextBlock}>
                      <Text style={styles.headerTitle}>Expense Tracker</Text>
                      <Text style={styles.headerSubtitle}>
                        Sunday, February 1, 2026
                      </Text>
                    </View>
                    <Pressable
                      style={styles.addFab}
                      onPress={() => setQuickAddOpen(true)}
                    >
                      <Text style={styles.addFabText}>+</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.statsRow}>
                  <View style={[styles.statCard, styles.statIncome]}>
                    <Text style={styles.statLabel}>Total Income</Text>
                    <Text style={styles.statValue}>
                      {formatCurrency(summary.income)}
                    </Text>
                    <View style={styles.statBadge}>
                      <Text style={styles.statBadgeText}>↑</Text>
                    </View>
                  </View>
                  <View style={[styles.statCard, styles.statExpense]}>
                    <Text style={styles.statLabel}>Total Expense</Text>
                    <Text style={styles.statValue}>
                      -{formatCurrency(summary.expense)}
                    </Text>
                    <View style={[styles.statBadge, styles.statBadgeExpense]}>
                      <Text style={styles.statBadgeText}>↓</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>My Accounts</Text>
                  <Pressable onPress={() => setAccountOpen(true)}>
                    <Text style={styles.seeAllButton}>Add</Text>
                  </Pressable>
                </View>
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.accountsRow}
                  data={accounts}
                  keyExtractor={item => item.id}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>No accounts yet.</Text>
                  }
                  renderItem={({ item, index }) => (
                    <View
                      style={[
                        styles.accountCard,
                        index % 3 === 0
                          ? styles.accountBlue
                          : index % 3 === 1
                            ? styles.accountPurple
                            : styles.accountGold,
                      ]}
                    >
                      <View style={styles.accountGlow} />
                      <View style={styles.accountGlowSecondary} />
                      <View style={styles.accountTopRow}>
                        <View style={styles.accountBrandRow}>
                          <Text style={styles.accountIconText}>
                            {item.type === 'bank'
                              ? '🏦'
                              : item.type === 'cash'
                                ? '💵'
                                : '👛'}
                          </Text>
                          <Text style={styles.accountName}>{item.name}</Text>
                        </View>
                        <Text style={styles.accountChip}>💳</Text>
                      </View>
                      <Text style={styles.accountTypeText}>
                        {item.type === 'bank'
                          ? 'Giro Konto'
                          : item.type === 'cash'
                            ? 'Cash Wallet'
                            : 'Multi-Currency'}
                      </Text>
                      <View style={styles.accountAmountRow}>
                        <Text style={styles.accountAmountText}>
                          {formatCurrency(item.balance)}
                        </Text>
                      </View>
                    </View>
                  )}
                />

                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Recent Transactions</Text>
                  <Pressable>
                    <Text style={styles.seeAllButton}>See All</Text>
                  </Pressable>
                </View>
              </View>
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No transactions this month.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.transactionCard}
                onPress={() => {
                  setEditingTransaction(item);
                  setQuickAddOpen(true);
                }}
              >
                <View style={styles.transactionIcon}>
                  <Text style={styles.transactionIconText}>
                    {item.type === 'income' ? '💳' : '🛒'}
                  </Text>
                </View>
                <View style={styles.transactionInfo}>
                  <Text style={styles.transactionTitle}>
                    {item.note ||
                      (item.type === 'income' ? 'Income' : 'Expense')}
                  </Text>
                  <Text style={styles.transactionMeta}>
                    {new Date(item.createdAt).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {item.accountName ? ` · ${item.accountName}` : ''}
                  </Text>
                  <Text style={styles.transactionSub}>
                    {item.category ?? 'Other'}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.transactionAmount,
                    item.type === 'expense' && styles.expenseText,
                  ]}
                >
                  {item.type === 'income' ? '+' : '-'}
                  {formatCurrency(item.amount)}
                </Text>
              </Pressable>
            )}
          />

          <QuickTransactionSheet
            visible={isQuickAddOpen}
            onClose={() => {
              setQuickAddOpen(false);
              setEditingTransaction(null);
            }}
            onSubmit={handleSubmitTransaction}
            accounts={accounts}
            currencySymbol={currencySymbol}
            onAddAccount={() => setAccountOpen(true)}
            initialValue={editingTransaction}
          />
          <AccountSheet
            visible={isAccountOpen}
            onClose={() => setAccountOpen(false)}
            onSubmit={handleAddAccount}
          />
        </>
      )}

      <View style={styles.tabBar}>
        <Pressable
          style={[
            styles.tabItem,
            activeScreen === 'home' && styles.tabItemActive,
          ]}
          onPress={() => setActiveScreen('home')}
        >
          <Text
            style={[
              styles.tabText,
              activeScreen === 'home' && styles.tabTextActive,
            ]}
          >
            Home
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabItem,
            activeScreen === 'analysis' && styles.tabItemActive,
          ]}
          onPress={() => setActiveScreen('analysis')}
        >
          <Text
            style={[
              styles.tabText,
              activeScreen === 'analysis' && styles.tabTextActive,
            ]}
          >
            Insights
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabItem,
            activeScreen === 'settings' && styles.tabItemActive,
          ]}
          onPress={() => setActiveScreen('settings')}
        >
          <Text
            style={[
              styles.tabText,
              activeScreen === 'settings' && styles.tabTextActive,
            ]}
          >
            Settings
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B1B3A',
  },
  scrollContent: {
    paddingBottom: 140,
  },
  headerWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  headerRow: {
    width: '100%',
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTextBlock: {
    alignItems: 'center',
    flex: 1,
    marginLeft: 32,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  addFab: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFabText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1B1B3A',
    lineHeight: 24,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
  },
  statIncome: {
    backgroundColor: '#DDF2E5',
  },
  statExpense: {
    backgroundColor: '#F7D7D5',
  },
  statLabel: {
    fontSize: 12,
    color: '#1F2A44',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2A44',
    marginTop: 8,
  },
  statBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2AA66F',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  statBadgeExpense: {
    backgroundColor: '#D65151',
  },
  statBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#141433',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
  },
  tabItemActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  tabText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  seeAllButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: 12,
    color: '#1B1B3A',
    fontWeight: '600',
  },
  accountsRow: {
    paddingHorizontal: 20,
    gap: 12,
  },
  accountCard: {
    borderRadius: 16,
    padding: 14,
    minWidth: 200,
    height: 110,
    overflow: 'hidden',
  },
  accountBlue: {
    backgroundColor: '#2B6CB0',
  },
  accountPurple: {
    backgroundColor: '#6B46C1',
  },
  accountGold: {
    backgroundColor: '#D69E2E',
  },
  accountGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.18)',
    top: -40,
    right: -20,
  },
  accountGlowSecondary: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.12)',
    bottom: -60,
    left: -30,
  },
  accountTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accountBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  accountIconText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  accountChip: {
    fontSize: 16,
    opacity: 0.9,
  },
  accountName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  accountTypeText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 8,
  },
  accountAmountRow: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  accountAmountText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'right',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  transactionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  transactionIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#E5E7F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionIconText: {
    fontSize: 16,
  },
  transactionInfo: {
    flex: 1,
    marginLeft: 10,
  },
  transactionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2A44',
  },
  transactionMeta: {
    fontSize: 11,
    color: '#6A7488',
    marginTop: 2,
  },
  transactionSub: {
    fontSize: 11,
    color: '#6A7488',
    marginTop: 2,
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D5CDB',
  },
  expenseText: {
    color: '#E14B4B',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.9)',
    marginTop: 12,
  },
});

export default App;

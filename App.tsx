/**
 * Expense tracker quick add UI
 * @format
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import QuickTransactionSheet from './src/components/QuickTransactionSheet';
import AccountSheet from './src/components/AccountSheet';
import { Account, Debt, DebtTransaction, DebtType, QuickTransaction } from './src/data/models';
import AnalysisScreen from './src/screens/AnalysisScreen';
import LoansScreen from './src/screens/LoansScreen';
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
  checkNotificationAccessPermission,
  openNotificationAccessSettings,
  subscribeToBankNotifications,
} from './src/platform/bankNotificationService';
import {
  addDebtRepayment,
  createLocalAccount,
  createLocalDebt,
  createLocalTransaction,
  clearLocalData,
  deleteLocalAccount,
  deleteLocalDebt,
  deleteLocalTransaction,
  exportFullBackupData,
  fetchDebtTransactions,
  fetchLocalAccounts,
  fetchLocalDebts,
  fetchLocalTransactions,
  getLocalSetting,
  initLocalDb,
  restoreFullBackupData,
  seedLocalDataIfEmpty,
  setLocalSetting,
  updateLocalAccount,
  updateLocalDebt,
  updateLocalTransaction,
} from './src/data/localDb';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './src/data/categories';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppContent />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [isQuickAddOpen, setQuickAddOpen] = useState(false);
  const [isAccountOpen, setAccountOpen] = useState(false);
  const [transactions, setTransactions] = useState<QuickTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [activeScreen, setActiveScreen] = useState<
    'home' | 'loans' | 'analysis' | 'settings'
  >('home');
  const [editingTransaction, setEditingTransaction] = useState<
    QuickTransaction | null
  >(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [hasOverlayPermission, setHasOverlayPermission] = useState(false);
  const [bubbleEnabled, setBubbleEnabled] = useState(false);
  const [isNotificationAccessGranted, setNotificationAccessGranted] =
    useState(false);
  const [isPermissionModalOpen, setPermissionModalOpen] = useState(false);

  const countries: CountryOption[] = useMemo(
    () => [
      { name: 'Pakistan', code: 'PK', currencySymbol: 'Rs ' },
      { name: 'India', code: 'IN', currencySymbol: '₹' },
      { name: 'United States', code: 'US', currencySymbol: '$' },
      { name: 'United Kingdom', code: 'GB', currencySymbol: '£' },
      { name: 'Eurozone', code: 'EU', currencySymbol: '€' },
      { name: 'Saudi Arabia', code: 'SA', currencySymbol: 'SAR ' },
      { name: 'United Arab Emirates', code: 'AE', currencySymbol: 'AED ' },
      { name: 'Japan', code: 'JP', currencySymbol: '¥' },
    ],
    [],
  );
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(
    countries[0],
  );
  const currencySymbol = selectedCountry.currencySymbol;

  const formattedToday = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  const totalAccountsBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.balance || 0), 0),
    [accounts],
  );

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
      const notifGranted = await checkNotificationAccessPermission();
      if (isMounted) {
        setHasOverlayPermission(granted);
        setBubbleEnabled(granted);
        setNotificationAccessGranted(notifGranted);
        if (!notifGranted) {
          setPermissionModalOpen(true);
        }
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
    const unsubscribe = subscribeToBankNotifications(transaction => {
      mergePendingTransactions([transaction]);
    });
    return () => unsubscribe();
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
        const notifGranted = await checkNotificationAccessPermission();
        setNotificationAccessGranted(notifGranted);
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
        const cleared = await getLocalSetting('db_cleared_v1');
        if (!cleared) {
          await clearLocalData();
          await setLocalSetting('db_cleared_v1', '1');
        }
        const savedCountryCode = await getLocalSetting('country_code');
        if (savedCountryCode) {
          const savedCountry = countries.find(
            item => item.code === savedCountryCode,
          );
          if (savedCountry) {
            setSelectedCountry(savedCountry);
          }
        }
        await seedLocalDataIfEmpty();
        const [accountList, transactionList, debtList] = await Promise.all([
          fetchLocalAccounts(),
          fetchLocalTransactions(),
          fetchLocalDebts(),
        ]);
        setAccounts(accountList);
        setTransactions(transactionList);
        setDebts(debtList);
      })
      .catch(() => null);
  }, [countries]);

  const handleAddDebt = async (payload: {
    personName: string;
    phone?: string;
    type: DebtType;
    amount: number;
    note?: string;
    dueDate?: string;
  }) => {
    await createLocalDebt(payload);
    const updated = await fetchLocalDebts();
    setDebts(updated);
  };

  const handleAddRepayment = async (debtId: string, amount: number, note?: string) => {
    await addDebtRepayment(debtId, amount, note);
    const updated = await fetchLocalDebts();
    setDebts(updated);
  };

  const handleDeleteDebt = async (debtId: string) => {
    await deleteLocalDebt(debtId);
    setDebts(current => current.filter(d => d.id !== debtId));
  };

  const handleFetchDebtTransactions = async (debtId: string) => {
    return await fetchDebtTransactions(debtId);
  };

  const handleRestoreBackup = async (jsonStr: string) => {
    const res = await restoreFullBackupData(jsonStr);
    const [updatedAccounts, updatedTransactions, updatedDebts] = await Promise.all([
      fetchLocalAccounts(),
      fetchLocalTransactions(),
      fetchLocalDebts(),
    ]);
    setAccounts(updatedAccounts);
    setTransactions(updatedTransactions);
    setDebts(updatedDebts);
    return res;
  };

  const handleSelectCountry = async (country: CountryOption) => {
    setSelectedCountry(country);
    try {
      await setLocalSetting('country_code', country.code);
    } catch {
      // ignore db failures
    }
  };

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
    if (!items || items.length === 0) return;

    // 1. Deduplicate items within the incoming batch itself (window: 3 mins / 180s)
    const dedupedItems: QuickTransaction[] = [];
    for (const item of items) {
      const itemTime = new Date(item.createdAt || Date.now()).getTime();
      const isDuplicateInBatch = dedupedItems.some(existing => {
        const existingTime = new Date(existing.createdAt || Date.now()).getTime();
        const sameAmount = Math.abs(Number(existing.amount) - Number(item.amount)) < 0.01;
        const sameType = existing.type === item.type;
        const timeDiff = Math.abs(existingTime - itemTime);
        return sameAmount && sameType && timeDiff < 180_000;
      });

      if (!isDuplicateInBatch) {
        dedupedItems.push(item);
      } else {
        console.log('[App] Duplicate transaction suppressed in incoming batch:', item);
      }
    }

    // 2. Persist to SQLite with database-level deduplication
    let hasNewTransactions = false;
    for (const item of dedupedItems) {
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
          deduplicate: true,
        });

        if (!result.isDuplicate) {
          hasNewTransactions = true;
        }
      } catch (err) {
        console.warn('[App] Error saving pending transaction:', err);
      }
    }

    // 3. Refresh accounts and transactions authoritative from SQLite DB
    if (hasNewTransactions || dedupedItems.length > 0) {
      try {
        const [freshAccounts, freshTxs] = await Promise.all([
          fetchLocalAccounts(),
          fetchLocalTransactions(),
        ]);
        setAccounts(freshAccounts);
        setTransactions(freshTxs);
      } catch {}
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
    if (editingAccount) {
      setAccounts(current =>
        current.map(item => (item.id === account.id ? account : item)),
      );
      try {
        const updated = await updateLocalAccount(account.id, {
          name: account.name,
          type: account.type,
          balance: account.balance,
        });
        setAccounts(current =>
          current.map(item => (item.id === updated.id ? updated : item)),
        );
      } catch {
        // keep local entry
      }
      setEditingAccount(null);
      return;
    }

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

  const handleDeleteAccount = async (account: Account) => {
    setAccounts(current => current.filter(item => item.id !== account.id));
    setTransactions(current =>
      current.filter(item => {
        if (item.accountId && item.accountId === account.id) {
          return false;
        }
        if (item.accountName && item.accountType) {
          return !(
            item.accountName.toLowerCase() === account.name.toLowerCase() &&
            item.accountType === account.type
          );
        }
        return true;
      }),
    );
    try {
      const result = await deleteLocalAccount(account.id);
      if (result.transactionIds.length) {
        setTransactions(current =>
          current.filter(item => !result.transactionIds.includes(item.id)),
        );
      }
    } catch {
      // ignore db failures
    }
    setEditingAccount(null);
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

  const handleDeleteTransaction = async (entry: QuickTransaction) => {
    setTransactions(current => current.filter(item => item.id !== entry.id));
    setAccounts(current => {
      let updated = [...current];
      const delta = entry.type === 'income' ? -entry.amount : entry.amount;
      const accountId =
        entry.accountId ??
        findAccountIdByDetails(updated, entry.accountName, entry.accountType);
      if (accountId) {
        updated = updated.map(account =>
          account.id === accountId
            ? { ...account, balance: account.balance + delta }
            : account,
        );
      }
      return updated;
    });

    try {
      const result = await deleteLocalTransaction(entry.id);
      if (result.account) {
        setAccounts(current =>
          current.map(item =>
            item.id === result.account!.id ? result.account! : item,
          ),
        );
      }
    } catch {
      // ignore db failures
    }
    setEditingTransaction(null);
    setQuickAddOpen(false);
  };

  return (
    <View style={styles.container}>
      {activeScreen === 'loans' ? (
        <LoansScreen
          debts={debts}
          accounts={accounts}
          currencySymbol={currencySymbol}
          onAddDebt={handleAddDebt}
          onAddRepayment={handleAddRepayment}
          onDeleteDebt={handleDeleteDebt}
          onFetchTransactions={handleFetchDebtTransactions}
        />
      ) : activeScreen === 'analysis' ? (
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
          onSelectCountry={handleSelectCountry}
          bubbleEnabled={bubbleEnabled}
          onToggleBubble={handleToggleBubble}
          isNotificationAccessGranted={isNotificationAccessGranted}
          onOpenNotificationAccessSettings={async () => {
            await openNotificationAccessSettings();
          }}
          onExportBackup={exportFullBackupData}
          onRestoreBackup={handleRestoreBackup}
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
                        {formattedToday}
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
                  <View style={styles.sectionTitleWithBadge}>
                    <Text style={styles.sectionTitle}>My Accounts</Text>
                    <View style={styles.accountsTotalBadge}>
                      <Text style={styles.accountsTotalBadgeLabel}>Total</Text>
                      <Text style={styles.accountsTotalBadgeAmount}>
                        {formatCurrency(totalAccountsBalance)}
                      </Text>
                    </View>
                  </View>
                  <Pressable onPress={() => {
                    setEditingAccount(null);
                    setAccountOpen(true);
                  }}>
                    <Text style={styles.seeAllButton}>+ Add</Text>
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
                    <Pressable
                      style={[
                        styles.accountCard,
                        index % 3 === 0
                          ? styles.accountBlue
                          : index % 3 === 1
                            ? styles.accountPurple
                            : styles.accountGold,
                      ]}
                      onPress={() => {
                        setEditingAccount(item);
                        setAccountOpen(true);
                      }}
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
                    </Pressable>
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
            onDelete={handleDeleteTransaction}
            accounts={accounts}
            currencySymbol={currencySymbol}
            onAddAccount={() => setAccountOpen(true)}
            initialValue={editingTransaction}
          />
          <AccountSheet
            visible={isAccountOpen}
            onClose={() => {
              setAccountOpen(false);
              setEditingAccount(null);
            }}
            onSubmit={handleAddAccount}
            onDelete={handleDeleteAccount}
            initialValue={editingAccount}
          />
        </>
      )}

      {/* 4-Tab Navigation Bar */}
      <View style={[styles.tabBar, { paddingBottom: Math.max(safeAreaInsets.bottom, 12) }]}>
        <Pressable
          style={[
            styles.tabItem,
            activeScreen === 'home' && styles.tabItemActive,
          ]}
          onPress={() => setActiveScreen('home')}
        >
          <Text style={[styles.tabIcon, activeScreen === 'home' && styles.tabIconActive]}>🏠</Text>
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
            activeScreen === 'loans' && styles.tabItemActive,
          ]}
          onPress={() => setActiveScreen('loans')}
        >
          <Text style={[styles.tabIcon, activeScreen === 'loans' && styles.tabIconActive]}>🤝</Text>
          <Text
            style={[
              styles.tabText,
              activeScreen === 'loans' && styles.tabTextActive,
            ]}
          >
            Loans
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabItem,
            activeScreen === 'analysis' && styles.tabItemActive,
          ]}
          onPress={() => setActiveScreen('analysis')}
        >
          <Text style={[styles.tabIcon, activeScreen === 'analysis' && styles.tabIconActive]}>📊</Text>
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
          <Text style={[styles.tabIcon, activeScreen === 'settings' && styles.tabIconActive]}>⚙️</Text>
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

      {/* Notification Permission Onboarding Modal */}
      <Modal
        visible={isPermissionModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setPermissionModalOpen(false)}
      >
        <View style={styles.permissionModalOverlay}>
          <View style={styles.permissionModalCard}>
            <View style={styles.permissionIconBadge}>
              <Text style={{ fontSize: 32 }}>🔔</Text>
            </View>
            <Text style={styles.permissionModalTitle}>Bank Alerts Auto-Tracking</Text>
            <Text style={styles.permissionModalDesc}>
              Fiscus can automatically read transaction alerts & SMS from your banks (Meezan, HBL, Easypaisa, JazzCash, SadaPay, etc.) and add them straight into your accounts!
            </Text>
            <Pressable
              style={styles.permissionEnableBtn}
              onPress={async () => {
                setPermissionModalOpen(false);
                await openNotificationAccessSettings();
              }}
            >
              <Text style={styles.permissionEnableBtnText}>Enable Auto-Detection</Text>
            </Pressable>
            <Pressable
              style={styles.permissionLaterBtn}
              onPress={() => setPermissionModalOpen(false)}
            >
              <Text style={styles.permissionLaterBtnText}>Maybe Later</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
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
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#1B1B3A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemActive: {
    backgroundColor: 'rgba(78, 124, 255, 0.15)',
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 4,
    opacity: 0.6,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: '#4E7CFF',
    fontWeight: '700',
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
  sectionTitleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountsTotalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(110, 231, 183, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    gap: 4,
  },
  accountsTotalBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
  },
  accountsTotalBadgeAmount: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6EE7B7',
  },
  permissionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionModalCard: {
    backgroundColor: '#1E2140',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  permissionIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(110, 231, 183, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  permissionModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionModalDesc: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  permissionEnableBtn: {
    backgroundColor: '#6EE7B7',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  permissionEnableBtnText: {
    color: '#1B1B3A',
    fontWeight: '800',
    fontSize: 14,
  },
  permissionLaterBtn: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  permissionLaterBtnText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 13,
    fontWeight: '600',
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
    paddingBottom: 120,
  },
  transactionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    marginHorizontal: 28,
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

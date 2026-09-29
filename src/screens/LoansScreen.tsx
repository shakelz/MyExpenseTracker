import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Account, Debt, DebtStatus, DebtTransaction, DebtType } from '../data/models';

type LoansScreenProps = {
  debts: Debt[];
  accounts: Account[];
  currencySymbol: string;
  onAddDebt: (payload: {
    personName: string;
    phone?: string;
    type: DebtType;
    amount: number;
    note?: string;
    dueDate?: string;
  }) => Promise<void>;
  onAddRepayment: (debtId: string, amount: number, note?: string) => Promise<void>;
  onDeleteDebt: (debtId: string) => Promise<void>;
  onRefreshDebts?: () => Promise<void>;
  onFetchTransactions: (debtId: string) => Promise<DebtTransaction[]>;
};

export default function LoansScreen({
  debts,
  accounts,
  currencySymbol,
  onAddDebt,
  onAddRepayment,
  onDeleteDebt,
  onFetchTransactions,
}: LoansScreenProps) {
  const safeAreaInsets = useSafeAreaInsets();

  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'lent' | 'borrowed' | 'settled'>('all');

  // Modal States
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isPaymentModalOpen, setPaymentModalOpen] = useState(false);
  const [isHistoryModalOpen, setHistoryModalOpen] = useState(false);

  const [selectedDebt, setSelectedDebt] = useState<Debt | null>(null);
  const [historyTransactions, setHistoryTransactions] = useState<DebtTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Add Debt Form State
  const [personName, setPersonName] = useState('');
  const [phone, setPhone] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('lent');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  const formatCurrency = (value: number) =>
    `${currencySymbol}${Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;

  // 1. Total Accounts Balance
  const totalAccountsBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.balance || 0), 0),
    [accounts],
  );

  // 2. Aggregate Totals
  const { totalLenaHai, totalDenaHai, lentCount, borrowedCount, settledCount } = useMemo(() => {
    let lena = 0;
    let dena = 0;
    let lCount = 0;
    let bCount = 0;
    let sCount = 0;

    debts.forEach(d => {
      if (d.status === 'settled') {
        sCount += 1;
        return;
      }
      if (d.type === 'lent') {
        lena += d.remainingAmount;
        lCount += 1;
      } else {
        dena += d.remainingAmount;
        bCount += 1;
      }
    });

    return {
      totalLenaHai: lena,
      totalDenaHai: dena,
      lentCount: lCount,
      borrowedCount: bCount,
      settledCount: sCount,
    };
  }, [debts]);

  // 3. Projected Balances
  // If user pays all debts: Accounts Balance - Total Dena Hai
  const balanceAfterPayingDenaHai = totalAccountsBalance - totalDenaHai;
  // If user collects all receivables: Accounts Balance + Total Lena Hai
  const balanceAfterCollectingLenaHai = totalAccountsBalance + totalLenaHai;
  // Net projected liquidity
  const netProjectedBalance = totalAccountsBalance + totalLenaHai - totalDenaHai;

  // Filtered debts list
  const filteredDebts = useMemo(() => {
    return debts.filter(item => {
      const matchesSearch =
        item.personName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.note && item.note.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.phone && item.phone.includes(searchQuery));

      if (!matchesSearch) return false;

      if (filterType === 'all') return true;
      if (filterType === 'settled') return item.status === 'settled';
      if (filterType === 'lent') return item.type === 'lent' && item.status !== 'settled';
      if (filterType === 'borrowed') return item.type === 'borrowed' && item.status !== 'settled';
      return true;
    });
  }, [debts, filterType, searchQuery]);

  const handleOpenAdd = () => {
    setPersonName('');
    setPhone('');
    setDebtType('lent');
    setAmount('');
    setNote('');
    setDueDate('');
    setAddModalOpen(true);
  };

  const handleSubmitAdd = async () => {
    Keyboard.dismiss();
    const cleanAmount = (amount || '').replace(/,/g, '.').trim();
    const numAmount = parseFloat(cleanAmount);
    if (!personName.trim()) {
      Alert.alert('Required', 'Please enter a person name');
      return;
    }
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Required', 'Please enter a valid amount');
      return;
    }

    try {
      await onAddDebt({
        personName: personName.trim(),
        phone: phone.trim() || undefined,
        type: debtType,
        amount: numAmount,
        note: note.trim() || undefined,
        dueDate: dueDate.trim() || undefined,
      });
      setAddModalOpen(false);
      Alert.alert('Record Saved', `Successfully added "${personName.trim()}" to your Hisaab.`);
    } catch (err: any) {
      console.error('Failed to add debt:', err);
      Alert.alert('Error', `Failed to save loan record: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleOpenPayment = (debt: Debt) => {
    setSelectedDebt(debt);
    setPaymentAmount('');
    setPaymentNote('');
    setPaymentModalOpen(true);
  };

  const handleSubmitPayment = async () => {
    if (!selectedDebt) return;
    Keyboard.dismiss();
    const cleanAmount = (paymentAmount || '').replace(/,/g, '.').trim();
    const numAmount = parseFloat(cleanAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Required', 'Please enter a valid payment amount');
      return;
    }
    if (numAmount > selectedDebt.remainingAmount) {
      Alert.alert(
        'Warning',
        `Payment amount (${formatCurrency(numAmount)}) exceeds remaining balance (${formatCurrency(selectedDebt.remainingAmount)}). Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Yes',
            onPress: async () => {
              await onAddRepayment(selectedDebt.id, numAmount, paymentNote.trim() || undefined);
              setPaymentModalOpen(false);
            },
          },
        ],
      );
      return;
    }

    try {
      await onAddRepayment(selectedDebt.id, numAmount, paymentNote.trim() || undefined);
      setPaymentModalOpen(false);
      Alert.alert('Payment Recorded', `Successfully recorded payment of ${formatCurrency(numAmount)}.`);
    } catch (err: any) {
      console.error('Failed to record repayment:', err);
      Alert.alert('Error', `Failed to record payment: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleOpenHistory = async (debt: Debt) => {
    setSelectedDebt(debt);
    setLoadingHistory(true);
    setHistoryModalOpen(true);
    try {
      const list = await onFetchTransactions(debt.id);
      setHistoryTransactions(list);
    } catch {
      setHistoryTransactions([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleShareWhatsApp = (debt: Debt) => {
    const isLent = debt.type === 'lent';
    const message = isLent
      ? `Assalam-o-Alaikum ${debt.personName}, gentle reminder regarding remaining balance of ${formatCurrency(debt.remainingAmount)}${debt.note ? ` for "${debt.note}"` : ''}. Thank you! (via Fiscus)`
      : `Assalam-o-Alaikum ${debt.personName}, this is regarding the amount of ${formatCurrency(debt.remainingAmount)} I owe you. I will clear it shortly. Thank you! (via Fiscus)`;

    const phoneClean = debt.phone ? debt.phone.replace(/[^0-9+]/g, '') : '';
    const url = phoneClean
      ? `whatsapp://send?phone=${phoneClean}&text=${encodeURIComponent(message)}`
      : `whatsapp://send?text=${encodeURIComponent(message)}`;

    Linking.canOpenURL(url)
      .then(supported => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Alert.alert('WhatsApp', 'WhatsApp is not installed on this device.');
        }
      })
      .catch(() => {
        Alert.alert('Error', 'Unable to open WhatsApp.');
      });
  };

  const handleDelete = (debt: Debt) => {
    Alert.alert(
      'Delete Entry',
      `Are you sure you want to delete ${debt.personName}'s loan record and its payment history?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await onDeleteDebt(debt.id);
            if (isHistoryModalOpen) {
              setHistoryModalOpen(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredDebts}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {/* Top Bar Header */}
            <View style={[styles.headerWrap, { paddingTop: safeAreaInsets.top + 14 }]}>
              <View style={styles.headerRow}>
                <View>
                  <Text style={styles.headerTitle}>Lene Dene Ka Hisaab</Text>
                  <Text style={styles.headerSubtitle}>Khata Ledger & Loan Tracker</Text>
                </View>
                <Pressable style={styles.addBtn} onPress={handleOpenAdd}>
                  <Text style={styles.addBtnText}>+ New</Text>
                </Pressable>
              </View>

              {/* Requirement: Total amount beside / on this page */}
              <View style={styles.totalAccountsCard}>
                <View style={styles.totalAccountsLeft}>
                  <Text style={styles.totalAccountsLabel}>Current Total Balance (All Accounts)</Text>
                  <Text style={styles.totalAccountsAmount}>
                    {formatCurrency(totalAccountsBalance)}
                  </Text>
                </View>
                <View style={styles.totalAccountsBadge}>
                  <Text style={styles.totalAccountsBadgeText}>🏦 Active</Text>
                </View>
              </View>
            </View>

            {/* Lena Hai vs Dena Hai Cards */}
            <View style={styles.statsRow}>
              {/* Lena Hai (Lent / Receivable) */}
              <Pressable
                style={[
                  styles.statCard,
                  styles.statLena,
                  filterType === 'lent' && styles.statActiveCard,
                ]}
                onPress={() => setFilterType(filterType === 'lent' ? 'all' : 'lent')}
              >
                <View style={styles.statHeader}>
                  <Text style={styles.statLabel}>Lena Hai (Receivable)</Text>
                  <View style={[styles.statIconBadge, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                    <Text style={{ color: '#10B981', fontSize: 13, fontWeight: '700' }}>↓</Text>
                  </View>
                </View>
                <Text style={[styles.statAmount, { color: '#10B981' }]}>
                  +{formatCurrency(totalLenaHai)}
                </Text>
                <Text style={styles.statCount}>{lentCount} people pending</Text>
              </Pressable>

              {/* Dena Hai (Borrowed / Payable) */}
              <Pressable
                style={[
                  styles.statCard,
                  styles.statDena,
                  filterType === 'borrowed' && styles.statActiveCard,
                ]}
                onPress={() => setFilterType(filterType === 'borrowed' ? 'all' : 'borrowed')}
              >
                <View style={styles.statHeader}>
                  <Text style={styles.statLabel}>Dena Hai (Payable)</Text>
                  <View style={[styles.statIconBadge, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
                    <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '700' }}>↑</Text>
                  </View>
                </View>
                <Text style={[styles.statAmount, { color: '#EF4444' }]}>
                  -{formatCurrency(totalDenaHai)}
                </Text>
                <Text style={styles.statCount}>{borrowedCount} people pending</Text>
              </Pressable>
            </View>

            {/* Impact Calculator: Dena minus kare toh kitne bachte & Lena add kare toh kitne */}
            <View style={styles.calculatorCard}>
              <View style={styles.calcHeaderRow}>
                <Text style={styles.calcTitle}>Balance Impact Calculator</Text>
                <Text style={styles.calcTag}>Real-Time Projection</Text>
              </View>

              <View style={styles.calcRow}>
                <View style={styles.calcItem}>
                  <Text style={styles.calcLabel}>Agar Dena Hai Pay Karein</Text>
                  <Text
                    style={[
                      styles.calcValue,
                      { color: balanceAfterPayingDenaHai >= 0 ? '#60A5FA' : '#F87171' },
                    ]}
                  >
                    {formatCurrency(balanceAfterPayingDenaHai)}
                  </Text>
                  <Text style={styles.calcSub}>Bachte Apne Paas</Text>
                </View>

                <View style={styles.calcDivider} />

                <View style={styles.calcItem}>
                  <Text style={styles.calcLabel}>Agar Lena Hai Vasool Ho</Text>
                  <Text style={[styles.calcValue, { color: '#34D399' }]}>
                    {formatCurrency(balanceAfterCollectingLenaHai)}
                  </Text>
                  <Text style={styles.calcSub}>Bachte Apne Paas</Text>
                </View>
              </View>

              <View style={styles.calcFooter}>
                <Text style={styles.calcFooterLabel}>Net Khata Worth:</Text>
                <Text
                  style={[
                    styles.calcFooterValue,
                    { color: netProjectedBalance >= totalAccountsBalance ? '#34D399' : '#FCD34D' },
                  ]}
                >
                  {formatCurrency(netProjectedBalance)}
                </Text>
              </View>
            </View>

            {/* Search and Filters */}
            <View style={styles.searchSection}>
              <View style={styles.searchBar}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search person or note..."
                  placeholderTextColor="#7D8597"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <Pressable onPress={() => setSearchQuery('')}>
                    <Text style={styles.clearSearch}>✕</Text>
                  </Pressable>
                )}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterChipsRow}
              >
                <Pressable
                  style={[styles.filterChip, filterType === 'all' && styles.filterChipActive]}
                  onPress={() => setFilterType('all')}
                >
                  <Text style={[styles.filterChipText, filterType === 'all' && styles.filterChipTextActive]}>
                    All ({debts.length})
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.filterChip, filterType === 'lent' && styles.filterChipActive]}
                  onPress={() => setFilterType('lent')}
                >
                  <Text style={[styles.filterChipText, filterType === 'lent' && styles.filterChipTextActive]}>
                    Lena Hai ({lentCount})
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.filterChip, filterType === 'borrowed' && styles.filterChipActive]}
                  onPress={() => setFilterType('borrowed')}
                >
                  <Text style={[styles.filterChipText, filterType === 'borrowed' && styles.filterChipTextActive]}>
                    Dena Hai ({borrowedCount})
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.filterChip, filterType === 'settled' && styles.filterChipActive]}
                  onPress={() => setFilterType('settled')}
                >
                  <Text style={[styles.filterChipText, filterType === 'settled' && styles.filterChipTextActive]}>
                    Settled ({settledCount})
                  </Text>
                </Pressable>
              </ScrollView>
            </View>

            <View style={styles.listHeaderSection}>
              <Text style={styles.listHeaderTitle}>Person-wise Records</Text>
              <Text style={styles.listHeaderCount}>
                Showing {filteredDebts.length} {filteredDebts.length === 1 ? 'record' : 'records'}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🤝</Text>
            <Text style={styles.emptyTitle}>No Loan Records Found</Text>
            <Text style={styles.emptySubtitle}>
              Tap "+ New" to add your first "Lena Hai" or "Dena Hai" hisaab.
            </Text>
            <Pressable style={styles.emptyAddBtn} onPress={handleOpenAdd}>
              <Text style={styles.emptyAddBtnText}>+ Add Hisaab</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => {
          const isLent = item.type === 'lent';
          const isSettled = item.status === 'settled';
          const progress = item.amount > 0 ? (item.amount - item.remainingAmount) / item.amount : 0;
          const paidAmount = item.amount - item.remainingAmount;

          return (
            <Pressable style={styles.personCard} onPress={() => handleOpenHistory(item)}>
              <View style={styles.personTopRow}>
                {/* Avatar initial with color badge */}
                <View
                  style={[
                    styles.avatarBadge,
                    { borderColor: isSettled ? '#6B7280' : isLent ? '#10B981' : '#EF4444' },
                  ]}
                >
                  <Text style={styles.avatarText}>
                    {item.personName ? item.personName.charAt(0).toUpperCase() : '?'}
                  </Text>
                </View>

                {/* Name & Note */}
                <View style={styles.personMainInfo}>
                  <View style={styles.personTitleRow}>
                    <Text style={styles.personNameText}>{item.personName}</Text>
                    {isSettled ? (
                      <View style={styles.settledBadge}>
                        <Text style={styles.settledBadgeText}>✓ Settled</Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.typeBadge,
                          {
                            backgroundColor: isLent
                              ? 'rgba(16, 185, 129, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeBadgeText,
                            { color: isLent ? '#34D399' : '#F87171' },
                          ]}
                        >
                          {isLent ? 'Lena Hai' : 'Dena Hai'}
                        </Text>
                      </View>
                    )}
                  </View>

                  {item.phone ? <Text style={styles.personPhoneText}>{item.phone}</Text> : null}
                  {item.note ? <Text style={styles.personNoteText}>{item.note}</Text> : null}
                  {item.dueDate ? (
                    <Text style={styles.personDueText}>📅 Due: {item.dueDate}</Text>
                  ) : null}
                </View>

                {/* Amount Column */}
                <View style={styles.personAmountCol}>
                  <Text
                    style={[
                      styles.personRemainingText,
                      { color: isSettled ? '#9CA3AF' : isLent ? '#34D399' : '#F87171' },
                    ]}
                  >
                    {formatCurrency(item.remainingAmount)}
                  </Text>
                  <Text style={styles.personTotalText}>of {formatCurrency(item.amount)}</Text>
                </View>
              </View>

              {/* Progress Bar */}
              {!isSettled && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBarBackground}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(100, Math.max(0, progress * 100))}%`,
                          backgroundColor: isLent ? '#10B981' : '#EF4444',
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.progressLabelRow}>
                    <Text style={styles.progressLabelText}>
                      Paid: {formatCurrency(paidAmount)} ({Math.round(progress * 100)}%)
                    </Text>
                    <Text style={styles.progressLabelText}>
                      Remaining: {formatCurrency(item.remainingAmount)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Card Bottom Actions */}
              <View style={styles.cardActionsRow}>
                {!isSettled && (
                  <Pressable
                    style={styles.actionBtnPrimary}
                    onPress={() => handleOpenPayment(item)}
                  >
                    <Text style={styles.actionBtnPrimaryText}>
                      + {isLent ? 'Vasooli' : 'Payment'}
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  style={styles.actionBtnWhatsApp}
                  onPress={() => handleShareWhatsApp(item)}
                >
                  <Text style={styles.actionBtnWhatsAppText}>💬 WhatsApp</Text>
                </Pressable>

                <Pressable
                  style={styles.actionBtnSecondary}
                  onPress={() => handleOpenHistory(item)}
                >
                  <Text style={styles.actionBtnSecondaryText}>Ledger</Text>
                </Pressable>

                <Pressable
                  style={styles.actionBtnDelete}
                  onPress={() => handleDelete(item)}
                >
                  <Text style={styles.actionBtnDeleteText}>🗑</Text>
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      {/* MODAL 1: Add New Loan / Hisaab */}
      <Modal
        visible={isAddModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setAddModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Loan / Hisaab</Text>
              <Pressable onPress={() => setAddModalOpen(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 60 }}
            >
              {/* Type Switcher */}
              <View style={styles.modalTypeRow}>
                <Pressable
                  style={[
                    styles.modalTypeBtn,
                    debtType === 'lent' && styles.modalTypeBtnLentActive,
                  ]}
                  onPress={() => setDebtType('lent')}
                >
                  <Text
                    style={[
                      styles.modalTypeBtnText,
                      debtType === 'lent' && styles.modalTypeBtnTextActive,
                    ]}
                  >
                    Maine Diye (Lena Hai)
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.modalTypeBtn,
                    debtType === 'borrowed' && styles.modalTypeBtnBorrowedActive,
                  ]}
                  onPress={() => setDebtType('borrowed')}
                >
                  <Text
                    style={[
                      styles.modalTypeBtnText,
                      debtType === 'borrowed' && styles.modalTypeBtnTextActive,
                    ]}
                  >
                    Maine Liye (Dena Hai)
                  </Text>
                </Pressable>
              </View>

              {/* Person Name */}
              <Text style={styles.inputLabel}>Person Name *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Asad, Zaid, Landlord"
                placeholderTextColor="#6B7280"
                value={personName}
                onChangeText={setPersonName}
              />

              {/* Amount */}
              <Text style={styles.inputLabel}>Total Amount ({currencySymbol}) *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="0.00"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />

              {/* Phone (Optional) */}
              <Text style={styles.inputLabel}>Phone Number (For WhatsApp reminders)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="+92 300 1234567"
                placeholderTextColor="#6B7280"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />

              {/* Due Date (Optional) */}
              <Text style={styles.inputLabel}>Due Date (Optional e.g. YYYY-MM-DD)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="2026-03-01"
                placeholderTextColor="#6B7280"
                value={dueDate}
                onChangeText={setDueDate}
              />

              {/* Note / Purpose */}
              <Text style={styles.inputLabel}>Note / Purpose</Text>
              <TextInput
                style={[styles.textInput, { height: 70 }]}
                placeholder="e.g. Shop renovation advance, Emergency help"
                placeholderTextColor="#6B7280"
                multiline
                value={note}
                onChangeText={setNote}
              />

              {/* Submit Button */}
              <Pressable style={styles.submitModalBtn} onPress={handleSubmitAdd}>
                <Text style={styles.submitModalBtnText}>Save Entry</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: Record Repayment / Partial Payment */}
      <Modal
        visible={isPaymentModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setPaymentModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDebt?.type === 'lent' ? 'Record Vasooli' : 'Record Payment'}
              </Text>
              <Pressable onPress={() => setPaymentModalOpen(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {selectedDebt && (
              <View style={styles.paymentDebtInfo}>
                <Text style={styles.paymentPersonName}>{selectedDebt.personName}</Text>
                <Text style={styles.paymentRemainingLabel}>
                  Remaining: {formatCurrency(selectedDebt.remainingAmount)}
                </Text>
              </View>
            )}

            <Text style={styles.inputLabel}>Payment Amount ({currencySymbol}) *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0.00"
              placeholderTextColor="#6B7280"
              keyboardType="numeric"
              value={paymentAmount}
              onChangeText={setPaymentAmount}
            />

            {/* Quick Amount Buttons */}
            {selectedDebt && (
              <View style={styles.quickAmountRow}>
                <Pressable
                  style={styles.quickAmountBtn}
                  onPress={() => setPaymentAmount(String(selectedDebt.remainingAmount))}
                >
                  <Text style={styles.quickAmountBtnText}>
                    Full ({formatCurrency(selectedDebt.remainingAmount)})
                  </Text>
                </Pressable>

                {selectedDebt.remainingAmount > 100 && (
                  <Pressable
                    style={styles.quickAmountBtn}
                    onPress={() => setPaymentAmount(String(Math.round(selectedDebt.remainingAmount / 2)))}
                  >
                    <Text style={styles.quickAmountBtnText}>
                      Half ({formatCurrency(Math.round(selectedDebt.remainingAmount / 2))})
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            <Text style={styles.inputLabel}>Payment Note</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Received via Easypaisa / Cash"
              placeholderTextColor="#6B7280"
              value={paymentNote}
              onChangeText={setPaymentNote}
            />

            <Pressable style={styles.submitModalBtn} onPress={handleSubmitPayment}>
              <Text style={styles.submitModalBtnText}>Confirm Payment</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL 3: Person Ledger / Transaction History */}
      <Modal
        visible={isHistoryModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setHistoryModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{selectedDebt?.personName}'s Ledger</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedDebt?.type === 'lent' ? 'Maine Diye (Lena Hai)' : 'Maine Liye (Dena Hai)'}
                </Text>
              </View>
              <Pressable onPress={() => setHistoryModalOpen(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {selectedDebt && (
              <View style={styles.ledgerSummaryCard}>
                <View style={styles.ledgerSummaryItem}>
                  <Text style={styles.ledgerSummaryLabel}>Total Principal</Text>
                  <Text style={styles.ledgerSummaryValue}>{formatCurrency(selectedDebt.amount)}</Text>
                </View>
                <View style={styles.ledgerSummaryDivider} />
                <View style={styles.ledgerSummaryItem}>
                  <Text style={styles.ledgerSummaryLabel}>Remaining Balance</Text>
                  <Text
                    style={[
                      styles.ledgerSummaryValue,
                      { color: selectedDebt.status === 'settled' ? '#10B981' : '#F87171' },
                    ]}
                  >
                    {formatCurrency(selectedDebt.remainingAmount)}
                  </Text>
                </View>
              </View>
            )}

            <Text style={styles.ledgerListTitle}>Payment Transactions History</Text>

            {loadingHistory ? (
              <Text style={styles.emptyHistoryText}>Loading transaction history...</Text>
            ) : historyTransactions.length === 0 ? (
              <View style={styles.emptyHistoryWrap}>
                <Text style={styles.emptyHistoryText}>No payments recorded yet.</Text>
                <Text style={styles.emptyHistorySub}>Full initial amount is still pending.</Text>
              </View>
            ) : (
              <FlatList
                data={historyTransactions}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <View style={styles.historyItemRow}>
                    <View style={styles.historyIconBadge}>
                      <Text style={{ fontSize: 14 }}>💵</Text>
                    </View>
                    <View style={styles.historyItemInfo}>
                      <Text style={styles.historyItemNote}>
                        {item.note || 'Repayment / Installment'}
                      </Text>
                      <Text style={styles.historyItemDate}>
                        {new Date(item.createdAt).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                    <Text style={styles.historyItemAmount}>
                      +{formatCurrency(item.amount)}
                    </Text>
                  </View>
                )}
              />
            )}

            {selectedDebt && selectedDebt.status !== 'settled' && (
              <Pressable
                style={[styles.submitModalBtn, { marginTop: 16 }]}
                onPress={() => {
                  setHistoryModalOpen(false);
                  handleOpenPayment(selectedDebt);
                }}
              >
                <Text style={styles.submitModalBtnText}>+ Record New Payment</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B1B3A',
  },
  scrollContent: {
    paddingBottom: 130,
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
  addBtn: {
    backgroundColor: '#6EE7B7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addBtnText: {
    color: '#1B1B3A',
    fontWeight: '700',
    fontSize: 13,
  },
  totalAccountsCard: {
    backgroundColor: '#20224A',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  totalAccountsLeft: {
    flex: 1,
  },
  totalAccountsLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.65)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalAccountsAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
  },
  totalAccountsBadge: {
    backgroundColor: 'rgba(110, 231, 183, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  totalAccountsBadgeText: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#20224A',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  statLena: {
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  statDena: {
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  statActiveCard: {
    backgroundColor: '#2B2D62',
    borderColor: '#6EE7B7',
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  statIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statAmount: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  statCount: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  calculatorCard: {
    marginHorizontal: 20,
    backgroundColor: '#20224A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.2)',
  },
  calcHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  calcTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  calcTag: {
    fontSize: 10,
    color: '#60A5FA',
    fontWeight: '700',
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  calcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calcItem: {
    flex: 1,
  },
  calcLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.65)',
    marginBottom: 2,
  },
  calcValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  calcSub: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.45)',
    marginTop: 1,
  },
  calcDivider: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 12,
  },
  calcFooter: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calcFooterLabel: {
    fontSize: 12,
    color: '#D1D5DB',
    fontWeight: '600',
  },
  calcFooterValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  searchSection: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#20224A',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    padding: 0,
  },
  clearSearch: {
    color: '#9CA3AF',
    fontSize: 14,
    padding: 4,
  },
  filterChipsRow: {
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  filterChipActive: {
    backgroundColor: '#FFFFFF',
  },
  filterChipText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#1B1B3A',
    fontWeight: '700',
  },
  listHeaderSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 10,
    marginTop: 4,
  },
  listHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listHeaderCount: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  personCard: {
    backgroundColor: '#20224A',
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  personTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  personMainInfo: {
    flex: 1,
  },
  personTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  personNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  settledBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  settledBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
  },
  personPhoneText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 1,
  },
  personNoteText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 2,
  },
  personDueText: {
    fontSize: 11,
    color: '#FCD34D',
    marginTop: 2,
  },
  personAmountCol: {
    alignItems: 'flex-end',
  },
  personRemainingText: {
    fontSize: 16,
    fontWeight: '800',
  },
  personTotalText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  progressContainer: {
    marginTop: 12,
  },
  progressBarBackground: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  progressLabelText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  actionBtnPrimary: {
    backgroundColor: '#6EE7B7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnPrimaryText: {
    color: '#1B1B3A',
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnWhatsApp: {
    backgroundColor: '#25D366',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnWhatsAppText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnSecondaryText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  actionBtnDelete: {
    marginLeft: 'auto',
    padding: 6,
  },
  actionBtnDeleteText: {
    fontSize: 14,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    fontSize: 44,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyAddBtn: {
    backgroundColor: '#6EE7B7',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyAddBtnText: {
    color: '#1B1B3A',
    fontWeight: '700',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1E2140',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  modalCloseText: {
    fontSize: 18,
    color: '#9CA3AF',
    padding: 4,
  },
  modalTypeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  modalTypeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  modalTypeBtnLentActive: {
    backgroundColor: '#10B981',
  },
  modalTypeBtnBorrowedActive: {
    backgroundColor: '#EF4444',
  },
  modalTypeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalTypeBtnTextActive: {
    color: '#FFFFFF',
  },
  inputLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
    marginBottom: 6,
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#14172E',
    borderRadius: 10,
    color: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  submitModalBtn: {
    backgroundColor: '#6EE7B7',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  submitModalBtnText: {
    color: '#1B1B3A',
    fontWeight: '700',
    fontSize: 14,
  },
  paymentDebtInfo: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  paymentPersonName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  paymentRemainingLabel: {
    fontSize: 13,
    color: '#FCD34D',
    marginTop: 2,
    fontWeight: '600',
  },
  quickAmountRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  quickAmountBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  quickAmountBtnText: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '700',
  },
  ledgerSummaryCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  ledgerSummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  ledgerSummaryLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  ledgerSummaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  ledgerSummaryDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  ledgerListTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D1D5DB',
    marginBottom: 8,
  },
  historyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  historyIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  historyItemInfo: {
    flex: 1,
  },
  historyItemNote: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  historyItemDate: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  historyItemAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10B981',
  },
  emptyHistoryWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyHistoryText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
  },
  emptyHistorySub: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    marginTop: 2,
  },
});

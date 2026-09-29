import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { QuickTransaction } from '../data/models';

type TransactionActionModalProps = {
  visible: boolean;
  transaction: QuickTransaction | null;
  currencySymbol: string;
  formatCurrency: (value: number) => string;
  onClose: () => void;
  onEdit: (item: QuickTransaction) => void;
  onDuplicate: (item: QuickTransaction) => void;
  onDelete: (item: QuickTransaction) => void;
};

export default function TransactionActionModal({
  visible,
  transaction,
  currencySymbol,
  formatCurrency,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
}: TransactionActionModalProps) {
  if (!transaction) return null;

  const isIncome = transaction.type === 'income';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheetContainer} onPress={e => e.stopPropagation()}>
          <View style={styles.handle} />

          {/* Transaction Preview Card */}
          <View style={styles.previewCard}>
            <View style={styles.previewTop}>
              <View
                style={[
                  styles.iconWrap,
                  isIncome ? styles.iconWrapIncome : styles.iconWrapExpense,
                ]}
              >
                <Text style={styles.iconText}>{isIncome ? '💳' : '🛒'}</Text>
              </View>
              <View style={styles.previewInfo}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {transaction.note || (isIncome ? 'Income' : 'Expense')}
                </Text>
                <Text style={styles.previewSub}>
                  {transaction.category || 'Other'}
                  {transaction.accountName ? ` · ${transaction.accountName}` : ''}
                </Text>
              </View>
              <Text
                style={[
                  styles.previewAmount,
                  isIncome ? styles.amountIncome : styles.amountExpense,
                ]}
              >
                {isIncome ? '+' : '-'}
                {formatCurrency(transaction.amount)}
              </Text>
            </View>

            <View style={styles.previewDivider} />

            <View style={styles.previewMetaRow}>
              <Text style={styles.metaLabel}>Date:</Text>
              <Text style={styles.metaValue}>
                {new Date(transaction.createdAt).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>

          {/* Quick Smart Actions */}
          <Text style={styles.sectionLabel}>Smart Actions</Text>

          {/* 1. Edit */}
          <Pressable
            style={styles.actionRow}
            onPress={() => {
              onClose();
              onEdit(transaction);
            }}
          >
            <View style={[styles.actionIconBox, styles.actionIconBlue]}>
              <Text style={styles.actionIconSymbol}>✏️</Text>
            </View>
            <View style={styles.actionTextBox}>
              <Text style={styles.actionTitle}>Edit Details</Text>
              <Text style={styles.actionDesc}>
                Update amount, note, date, or category
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>

          {/* 2. Duplicate */}
          <Pressable
            style={styles.actionRow}
            onPress={() => {
              onClose();
              onDuplicate(transaction);
            }}
          >
            <View style={[styles.actionIconBox, styles.actionIconPurple]}>
              <Text style={styles.actionIconSymbol}>📋</Text>
            </View>
            <View style={styles.actionTextBox}>
              <Text style={styles.actionTitle}>Duplicate for Today</Text>
              <Text style={styles.actionDesc}>
                Quickly repeat this transaction
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>

          {/* 3. Delete */}
          <Pressable
            style={styles.actionRow}
            onPress={() => {
              onClose();
              onDelete(transaction);
            }}
          >
            <View style={[styles.actionIconBox, styles.actionIconRed]}>
              <Text style={styles.actionIconSymbol}>🗑️</Text>
            </View>
            <View style={styles.actionTextBox}>
              <Text style={[styles.actionTitle, styles.actionTitleDelete]}>
                Delete Transaction
              </Text>
              <Text style={styles.actionDesc}>
                Remove entry and restore account balance
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>

          {/* Cancel */}
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 16,
  },
  previewCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  previewTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapExpense: {
    backgroundColor: '#FEE2E2',
  },
  iconWrapIncome: {
    backgroundColor: '#DCFCE7',
  },
  iconText: {
    fontSize: 18,
  },
  previewInfo: {
    flex: 1,
    marginLeft: 12,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  previewSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  previewAmount: {
    fontSize: 16,
    fontWeight: '800',
  },
  amountExpense: {
    color: '#E11D48',
  },
  amountIncome: {
    color: '#16A34A',
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 10,
  },
  previewMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    marginBottom: 10,
  },
  actionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBlue: {
    backgroundColor: '#EEF2FF',
  },
  actionIconPurple: {
    backgroundColor: '#F3E8FF',
  },
  actionIconRed: {
    backgroundColor: '#FFE4E6',
  },
  actionIconSymbol: {
    fontSize: 16,
  },
  actionTextBox: {
    flex: 1,
    marginLeft: 12,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  actionTitleDelete: {
    color: '#E11D48',
  },
  actionDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  chevron: {
    fontSize: 20,
    color: '#94A3B8',
    fontWeight: '600',
    marginLeft: 6,
  },
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
});

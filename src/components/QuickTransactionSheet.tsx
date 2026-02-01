import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Account, QuickTransaction, TransactionType } from '../data/models';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../data/categories';

type QuickTransactionSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (entry: QuickTransaction) => void;
  accounts: Account[];
  currencySymbol: string;
  onAddAccount: () => void;
  initialValue?: QuickTransaction | null;
};

const defaultType: TransactionType = 'expense';

export default function QuickTransactionSheet({
  visible,
  onClose,
  onSubmit,
  accounts,
  currencySymbol,
  onAddAccount,
  initialValue,
}: QuickTransactionSheetProps) {
  const { height } = useWindowDimensions();
  const translateY = useMemo(() => new Animated.Value(height), [height]);
  const [type, setType] = useState<TransactionType>(defaultType);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [category, setCategory] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (visible) {
      Animated.timing(translateY, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: height,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [height, translateY, visible]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', event => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (initialValue) {
      setType(initialValue.type);
      setAmount(String(initialValue.amount));
      setNote(initialValue.note ?? '');
      setSelectedAccountId(initialValue.accountId ?? null);
      setCategory(initialValue.category ?? null);
      setSelectedDate(
        initialValue.createdAt ? new Date(initialValue.createdAt) : new Date(),
      );
      return;
    }
    setSelectedDate(new Date());
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
    const defaults = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    if (!category && defaults.length > 0) {
      setCategory(defaults[0]);
    }
  }, [accounts, category, initialValue, selectedAccountId, type, visible]);

  const handleSubmit = () => {
    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount)) {
      return;
    }
    const selectedAccount = accounts.find(
      account => account.id === selectedAccountId,
    );
    onSubmit({
      id: initialValue?.id ?? String(Date.now()),
      type,
      amount: numericAmount,
      note: note.trim(),
      createdAt: selectedDate.toISOString(),
      accountId: selectedAccount?.id,
      accountName: selectedAccount?.name,
      accountType: selectedAccount?.type,
      category: category ?? undefined,
    });
    setAmount('');
    setNote('');
    onClose();
  };

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
        style={styles.keyboardWrap}
      >
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: height * 0.85,
              paddingBottom: 28 + keyboardHeight,
              transform: [{ translateY }],
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.handle} />
            <Text style={styles.title}>Quick transaction</Text>
            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => setType('expense')}
                style={[
                  styles.toggleButton,
                  type === 'expense' && styles.toggleActive,
                ]}
              >
                <Text
                  style={[
                    styles.toggleText,
                    type === 'expense' && styles.toggleTextActive,
                  ]}
                >
                  Expense
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setType('income')}
                style={[
                  styles.toggleButton,
                  type === 'income' && styles.toggleActive,
                ]}
              >
                <Text
                  style={[
                    styles.toggleText,
                    type === 'income' && styles.toggleTextActive,
                  ]}
                >
                  Income
                </Text>
              </Pressable>
            </View>
            <Text style={styles.label}>Amount</Text>
            <View style={styles.accountHeader}>
              <Text style={styles.label}>Source account</Text>
              <Pressable onPress={onAddAccount}>
                <Text style={styles.addAccountText}>Add</Text>
              </Pressable>
            </View>
            {accounts.length === 0 ? (
              <Text style={styles.emptyAccountText}>
                Add a bank, cash, or wallet account.
              </Text>
            ) : (
              <View style={styles.accountRow}>
                {accounts.map(account => (
                  <Pressable
                    key={account.id}
                    style={[
                      styles.accountChip,
                      selectedAccountId === account.id &&
                        styles.accountChipActive,
                    ]}
                    onPress={() => setSelectedAccountId(account.id)}
                  >
                    <Text
                      style={[
                        styles.accountChipText,
                        selectedAccountId === account.id &&
                          styles.accountChipTextActive,
                      ]}
                    >
                      {account.name}
                    </Text>
                    <Text style={styles.accountChipSub}>
                      {account.type} · {currencySymbol}{account.balance.toFixed(2)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.categoryHeader}>
              <Text style={styles.label}>Category</Text>
            </View>
            <View style={styles.categoryRow}>
              {(type === 'expense'
                ? EXPENSE_CATEGORIES
                : INCOME_CATEGORIES
              ).map(item => (
                <Pressable
                  key={item}
                  style={[
                    styles.categoryChip,
                    category === item && styles.categoryChipActive,
                  ]}
                  onPress={() => setCategory(item)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === item && styles.categoryChipTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Amount</Text>
            <View style={styles.amountRow}>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#9AA3B2"
                style={[styles.input, styles.amountInput]}
              />
              <Pressable
                style={styles.calendarButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.calendarIcon}>📅</Text>
              </Pressable>
            </View>
            <Text style={styles.dateText}>
              {selectedDate.toDateString()}
            </Text>
            <Text style={styles.label}>Note</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Optional note"
              placeholderTextColor="#9AA3B2"
              style={[styles.input, styles.inputMultiline]}
              multiline
            />
            <Pressable style={styles.submitButton} onPress={handleSubmit}>
              <Text style={styles.submitText}>Save transaction</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            if (Platform.OS !== 'ios') {
              setShowDatePicker(false);
            }
            if (event.type === 'set' && date) {
              setSelectedDate(date);
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 1000,
  },
  keyboardWrap: {
    width: '100%',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 14, 30, 0.55)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  sheetContent: {
    paddingBottom: 24,
  },
  handle: {
    width: 54,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D4D9E5',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#101628',
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7DDEA',
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#EEF3FF',
    borderColor: '#4E7CFF',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5C6780',
  },
  toggleTextActive: {
    color: '#2343B8',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6A7488',
    marginBottom: 6,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  addAccountText: {
    color: '#4E7CFF',
    fontWeight: '700',
    fontSize: 12,
  },
  emptyAccountText: {
    color: '#8B94A7',
    fontSize: 12,
    marginBottom: 10,
  },
  accountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  accountChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7DDEA',
    backgroundColor: '#FFFFFF',
  },
  accountChipActive: {
    borderColor: '#4E7CFF',
    backgroundColor: '#EEF3FF',
  },
  accountChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2A44',
  },
  accountChipTextActive: {
    color: '#2343B8',
  },
  accountChipSub: {
    fontSize: 10,
    color: '#6A7488',
    marginTop: 2,
  },
  categoryHeader: {
    marginBottom: 6,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7DDEA',
    backgroundColor: '#FFFFFF',
  },
  categoryChipActive: {
    borderColor: '#4E7CFF',
    backgroundColor: '#EEF3FF',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2A44',
  },
  categoryChipTextActive: {
    color: '#2343B8',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D7DDEA',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: '#101628',
    marginBottom: 14,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  amountInput: {
    flex: 1,
    marginBottom: 0,
  },
  calendarButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7DDEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarIcon: {
    fontSize: 18,
  },
  dateText: {
    fontSize: 12,
    color: '#6A7488',
    marginBottom: 10,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#4E7CFF',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  submitText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});

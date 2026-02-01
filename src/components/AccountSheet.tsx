import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Account, AccountType } from '../data/models';

type AccountSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (account: Account) => void;
};

const ACCOUNT_TYPES: AccountType[] = ['bank', 'cash', 'wallet'];

export default function AccountSheet({
  visible,
  onClose,
  onSubmit,
}: AccountSheetProps) {
  const { height } = useWindowDimensions();
  const translateY = useMemo(() => new Animated.Value(height), [height]);
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [type, setType] = useState<AccountType>('bank');

  useEffect(() => {
    if (visible) {
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
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

  const handleSubmit = () => {
    if (!name.trim()) {
      return;
    }
    const amount = Number(balance);
    const nextBalance = Number.isNaN(amount) ? 0 : amount;
    onSubmit({
      id: String(Date.now()),
      name: name.trim(),
      type,
      balance: nextBalance,
    });
    setName('');
    setBalance('');
    setType('bank');
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
      >
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Add account</Text>
          <Text style={styles.label}>Account name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Bank or wallet name"
            placeholderTextColor="#9AA3B2"
            style={styles.input}
          />
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {ACCOUNT_TYPES.map(item => (
              <Pressable
                key={item}
                style={[
                  styles.typeChip,
                  type === item && styles.typeChipActive,
                ]}
                onPress={() => setType(item)}
              >
                <Text
                  style={[
                    styles.typeText,
                    type === item && styles.typeTextActive,
                  ]}
                >
                  {item.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Starting balance</Text>
          <TextInput
            value={balance}
            onChangeText={setBalance}
            placeholder="0.00"
            placeholderTextColor="#9AA3B2"
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <Pressable style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitText}>Save account</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 1000,
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
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6A7488',
    marginBottom: 6,
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
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  typeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D7DDEA',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  typeChipActive: {
    backgroundColor: '#EEF3FF',
    borderColor: '#4E7CFF',
  },
  typeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5C6780',
  },
  typeTextActive: {
    color: '#2343B8',
  },
  submitButton: {
    backgroundColor: '#4E7CFF',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  submitText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});

import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { QuickTransaction } from '../data/models';

type TransactionCardProps = {
  item: QuickTransaction;
  currencySymbol: string;
  formatCurrency: (value: number) => string;
  onPress: (item: QuickTransaction) => void;
  onEdit: (item: QuickTransaction) => void;
  onDelete: (item: QuickTransaction) => void;
  onLongPress: (item: QuickTransaction) => void;
};

export default function TransactionCard({
  item,
  formatCurrency,
  onPress,
  onEdit,
  onDelete,
  onLongPress,
}: TransactionCardProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const renderLeftActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [0.7, 1],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.leftActionsContainer}>
        <Pressable
          style={styles.actionBtnEdit}
          onPress={() => {
            swipeableRef.current?.close();
            onEdit(item);
          }}
        >
          <Animated.View style={[styles.actionContent, { transform: [{ scale }] }]}>
            <Text style={styles.actionIcon}>✏️</Text>
            <Text style={styles.actionText}>Edit</Text>
          </Animated.View>
        </Pressable>
      </View>
    );
  };

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.7],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.rightActionsContainer}>
        <Pressable
          style={styles.actionBtnDelete}
          onPress={() => {
            swipeableRef.current?.close();
            onDelete(item);
          }}
        >
          <Animated.View style={[styles.actionContent, { transform: [{ scale }] }]}>
            <Text style={styles.actionIcon}>🗑️</Text>
            <Text style={styles.actionText}>Delete</Text>
          </Animated.View>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      <Swipeable
        ref={swipeableRef}
        friction={2}
        leftThreshold={40}
        rightThreshold={40}
        renderLeftActions={renderLeftActions}
        renderRightActions={renderRightActions}
        containerStyle={styles.swipeContainer}
      >
        <Pressable
          style={styles.transactionCard}
          onPress={() => onPress(item)}
          onLongPress={() => onLongPress(item)}
          delayLongPress={300}
        >
          <View style={styles.transactionIcon}>
            <Text style={styles.transactionIconText}>
              {item.type === 'income' ? '💳' : '🛒'}
            </Text>
          </View>
          <View style={styles.transactionInfo}>
            <Text style={styles.transactionTitle}>
              {item.note || (item.type === 'income' ? 'Income' : 'Expense')}
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
      </Swipeable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 28,
    marginBottom: 10,
    borderRadius: 16,
    overflow: 'hidden',
  },
  swipeContainer: {
    backgroundColor: '#F1F4F9',
    borderRadius: 16,
  },
  transactionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
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
  leftActionsContainer: {
    width: 75,
    backgroundColor: '#2D5CDB',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  rightActionsContainer: {
    width: 75,
    backgroundColor: '#E14B4B',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  actionBtnEdit: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnDelete: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {
    fontSize: 18,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});

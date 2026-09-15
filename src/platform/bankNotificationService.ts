import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { QuickTransaction } from '../data/models';

const { BankNotification } = NativeModules;

export async function checkNotificationAccessPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || !BankNotification) {
    return false;
  }
  try {
    return await BankNotification.isNotificationListenerEnabled();
  } catch {
    return false;
  }
}

export async function openNotificationAccessSettings(): Promise<boolean> {
  if (Platform.OS !== 'android' || !BankNotification) {
    return false;
  }
  try {
    return await BankNotification.openNotificationListenerSettings();
  } catch {
    return false;
  }
}

export function subscribeToBankNotifications(
  onTransaction: (transaction: QuickTransaction) => void,
): () => void {
  if (Platform.OS !== 'android' || !BankNotification) {
    return () => {};
  }

  const emitter = new NativeEventEmitter(BankNotification);
  const subscription = emitter.addListener(
    'onBankNotificationReceived',
    (event: QuickTransaction) => {
      if (event && event.amount) {
        onTransaction(event);
      }
    },
  );

  return () => {
    subscription.remove();
  };
}

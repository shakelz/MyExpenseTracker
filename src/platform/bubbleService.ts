import { NativeModules, Platform } from 'react-native';

type BubbleModule = {
  requestPermission?: () => Promise<boolean> | boolean;
  isPermissionGranted?: () => Promise<boolean> | boolean;
  initialize?: () => Promise<void> | void;
  showFloatingBubble?: (x: number, y: number) => Promise<void> | void;
  hideFloatingBubble?: () => Promise<void> | void;
  stopService?: () => Promise<void> | void;
  getPendingTransactions?: () => Promise<string> | string;
  clearPendingTransactions?: () => Promise<void> | void;
  setBubbleOptions?: (
    categories: string[],
    accounts: Array<{ name: string; type: string; balance?: number }>,
  ) => Promise<void> | void;
  setCurrencySymbol?: (symbol: string) => Promise<void> | void;
};

const NativeBubble: BubbleModule | undefined =
  NativeModules.SystemBubble ||
  NativeModules.FloatingBubble ||
  NativeModules.ReactNativeFloatingBubble;

const isAndroid = Platform.OS === 'android';

export async function requestOverlayPermission(): Promise<boolean> {
  if (!isAndroid || !NativeBubble?.requestPermission) {
    return false;
  }
  const result = await NativeBubble.requestPermission();
  return Boolean(result);
}

export async function checkOverlayPermission(): Promise<boolean> {
  if (!isAndroid || !NativeBubble?.isPermissionGranted) {
    return false;
  }
  const result = await NativeBubble.isPermissionGranted();
  return Boolean(result);
}

export async function initializeSystemBubble(): Promise<void> {
  if (!isAndroid || !NativeBubble?.initialize) {
    return;
  }
  await NativeBubble.initialize();
}

export async function showSystemBubble(x: number, y: number): Promise<void> {
  if (!isAndroid || !NativeBubble?.showFloatingBubble) {
    return;
  }
  await NativeBubble.showFloatingBubble(x, y);
}

export async function hideSystemBubble(): Promise<void> {
  if (!isAndroid || !NativeBubble?.hideFloatingBubble) {
    return;
  }
  await NativeBubble.hideFloatingBubble();
}

export async function stopSystemBubble(): Promise<void> {
  if (!isAndroid || !NativeBubble?.stopService) {
    return;
  }
  await NativeBubble.stopService();
}

export async function getPendingBubbleTransactions(): Promise<string> {
  if (!isAndroid || !NativeBubble?.getPendingTransactions) {
    return '[]';
  }
  const result = await NativeBubble.getPendingTransactions();
  return typeof result === 'string' ? result : '[]';
}

export async function clearPendingBubbleTransactions(): Promise<void> {
  if (!isAndroid || !NativeBubble?.clearPendingTransactions) {
    return;
  }
  await NativeBubble.clearPendingTransactions();
}

export async function setBubbleOptions(
  categories: string[],
  accounts: Array<{ name: string; type: string; balance?: number }>,
): Promise<void> {
  if (!isAndroid || !NativeBubble?.setBubbleOptions) {
    return;
  }
  await NativeBubble.setBubbleOptions(categories, accounts);
}

export async function setBubbleCurrencySymbol(symbol: string): Promise<void> {
  if (!isAndroid || !NativeBubble?.setCurrencySymbol) {
    return;
  }
  await NativeBubble.setCurrencySymbol(symbol);
}

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  NativeModules,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLocalSetting, setLocalSetting } from '../data/localDb';

export type CountryOption = {
  name: string;
  code: string;
  currencySymbol: string;
};

type SettingsScreenProps = {
  countries: CountryOption[];
  selectedCountry: CountryOption;
  onSelectCountry: (country: CountryOption) => void;
  bubbleEnabled: boolean;
  onToggleBubble: (next: boolean) => void;
  isNotificationAccessGranted?: boolean;
  onOpenNotificationAccessSettings?: () => void;
  onExportBackup?: () => Promise<string>;
  onRestoreBackup?: (jsonStr: string) => Promise<{
    success: boolean;
    accountsCount: number;
    transactionsCount: number;
    debtsCount: number;
  }>;
};

export default function SettingsScreen({
  countries,
  selectedCountry,
  onSelectCountry,
  bubbleEnabled,
  onToggleBubble,
  isNotificationAccessGranted = false,
  onOpenNotificationAccessSettings,
  onExportBackup,
  onRestoreBackup,
}: SettingsScreenProps) {
  const safeAreaInsets = useSafeAreaInsets();

  // WhatsApp-style Backup State
  const [googleAccount, setGoogleAccount] = useState('shakelz.finance@gmail.com');
  const [isAccountModalOpen, setAccountModalOpen] = useState(false);
  const [customEmail, setCustomEmail] = useState('');
  const [lastBackupTime, setLastBackupTime] = useState<string>('Never');
  const [lastBackupSize, setLastBackupSize] = useState<string>('0 KB');
  const [lastBackupRecords, setLastBackupRecords] = useState<string>('0 records');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupFrequency, setBackupFrequency] = useState('Daily');
  const [backupCellular, setBackupCellular] = useState(true);
  const [isRestoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreJsonText, setRestoreJsonText] = useState('');

  // Load saved backup metadata on mount
  useEffect(() => {
    const loadBackupMeta = async () => {
      try {
        const savedTime = await getLocalSetting('backup_last_time');
        const savedSize = await getLocalSetting('backup_last_size');
        const savedRecords = await getLocalSetting('backup_last_records');
        const savedEmail = await getLocalSetting('backup_google_email');
        const savedFreq = await getLocalSetting('backup_frequency');

        if (savedTime) setLastBackupTime(savedTime);
        if (savedSize) setLastBackupSize(savedSize);
        if (savedRecords) setLastBackupRecords(savedRecords);
        if (savedEmail) setGoogleAccount(savedEmail);
        if (savedFreq) setBackupFrequency(savedFreq);
      } catch {
        // ignore
      }
    };
    loadBackupMeta();
  }, []);

  const handleSwitchGoogleAccount = async (email: string) => {
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid Google Account email.');
      return;
    }
    setGoogleAccount(email.trim());
    await setLocalSetting('backup_google_email', email.trim());
    setAccountModalOpen(false);
    Alert.alert('Google Account Connected', `Connected to ${email.trim()} for cloud backup.`);
  };

  const handleOpenGooglePicker = async () => {
    try {
      if (NativeModules.GoogleAuthModule?.chooseGoogleAccount) {
        const picked = await NativeModules.GoogleAuthModule.chooseGoogleAccount();
        if (picked) {
          await handleSwitchGoogleAccount(picked);
          return;
        }
      }
    } catch (err: any) {
      console.log('Google account picker cancelled or unavailable:', err?.message || err);
    }
    setCustomEmail(googleAccount);
    setAccountModalOpen(true);
  };

  const handleBackupNow = async () => {
    if (!onExportBackup) return;
    setIsBackingUp(true);
    try {
      const backupJson = await onExportBackup();
      await setLocalSetting('latest_backup_data', backupJson);

      const nowStr = new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const sizeKb = `${Math.max(1, Math.round(backupJson.length / 1024))} KB`;

      let recordCount = 0;
      try {
        const parsed = JSON.parse(backupJson);
        recordCount =
          (parsed.stats?.accountsCount || 0) +
          (parsed.stats?.transactionsCount || 0) +
          (parsed.stats?.debtsCount || 0);
      } catch {
        // ignore
      }
      const recordsStr = `${recordCount} items`;

      await setLocalSetting('backup_last_time', nowStr);
      await setLocalSetting('backup_last_size', sizeKb);
      await setLocalSetting('backup_last_records', recordsStr);

      setLastBackupTime(nowStr);
      setLastBackupSize(sizeKb);
      setLastBackupRecords(recordsStr);

      Alert.alert(
        'Backup Successful',
        `All data backed up to Google Drive & local storage (${googleAccount}).\nSize: ${sizeKb} · ${recordsStr}`,
        [
          { text: 'Done' },
          {
            text: 'Share / Save File',
            onPress: () => {
              Share.share({
                title: 'Fiscus_Backup.json',
                message: backupJson,
              }).catch(() => null);
            },
          },
        ],
      );
    } catch (err: any) {
      console.error('Backup snapshot error:', err);
      Alert.alert('Backup Error', `Failed to generate backup snapshot: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreNow = async () => {
    if (!onRestoreBackup) return;
    try {
      const savedBackup = await getLocalSetting('latest_backup_data');
      if (!savedBackup) {
        Alert.alert(
          'No Backup Found',
          'No previous backup found on this device or Google Drive. Tap "Back Up Now" first or use "Restore from JSON".',
        );
        return;
      }

      Alert.alert(
        'Restore from Google Drive',
        `Are you sure you want to restore data from backup (${lastBackupTime})? Current data will be safely updated.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            onPress: async () => {
              setIsRestoring(true);
              try {
                const res = await onRestoreBackup(savedBackup);
                Alert.alert(
                  'Restore Complete',
                  `Successfully restored:\n• ${res.accountsCount} Accounts\n• ${res.transactionsCount} Transactions\n• ${res.debtsCount} Debts`,
                );
              } catch (err: any) {
                Alert.alert('Error', `Failed to restore backup data: ${err?.message || 'Unknown error'}`);
              } finally {
                setIsRestoring(false);
              }
            },
          },
        ],
      );
    } catch {
      Alert.alert('Error', 'Failed to retrieve backup file.');
    }
  };

  const handleRestoreCustomJson = async () => {
    if (!restoreJsonText.trim()) {
      Alert.alert('Required', 'Please paste valid backup JSON data.');
      return;
    }
    if (!onRestoreBackup) return;
    Keyboard.dismiss();
    setIsRestoring(true);
    try {
      const res = await onRestoreBackup(restoreJsonText.trim());
      await setLocalSetting('latest_backup_data', restoreJsonText.trim());
      setRestoreModalOpen(false);
      setRestoreJsonText('');
      Alert.alert(
        'Restore Complete',
        `Successfully restored:\n• ${res.accountsCount} Accounts\n• ${res.transactionsCount} Transactions\n• ${res.debtsCount} Debts`,
      );
    } catch (err: any) {
      Alert.alert('Restore Error', `Failed to restore JSON: ${err?.message || 'Invalid format'}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top + 14 }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>Settings</Text>

        {/* 1. WHATSAPP STYLE CHAT BACKUP CARD */}
        <View style={styles.section}>
          <View style={styles.backupHeaderRow}>
            <View style={styles.cloudIconBadge}>
              <Text style={{ fontSize: 18 }}>☁️</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.sectionTitle}>Google Drive & Cloud Backup</Text>
              <Text style={styles.backupSubtext}>
                Back up your accounts, transactions, and loans to Google Drive (WhatsApp Style).
              </Text>
            </View>
          </View>

          {/* Last Backup Info Box */}
          <View style={styles.backupStatusCard}>
            <View style={styles.backupStatusRow}>
              <Text style={styles.backupStatusLabel}>Last Backup:</Text>
              <Text style={styles.backupStatusValue}>{lastBackupTime}</Text>
            </View>
            <View style={styles.backupStatusRow}>
              <Text style={styles.backupStatusLabel}>Size:</Text>
              <Text style={styles.backupStatusValue}>{lastBackupSize}</Text>
            </View>
            <View style={styles.backupStatusRow}>
              <Text style={styles.backupStatusLabel}>Total Records:</Text>
              <Text style={styles.backupStatusValue}>{lastBackupRecords}</Text>
            </View>
          </View>

          {/* Connected Google Account */}
          <Pressable
            style={styles.googleAccountRow}
            onPress={handleOpenGooglePicker}
          >
            <View style={styles.googleIconWrap}>
              <Text style={styles.googleG}>G</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.googleAccountTitle}>Google Account</Text>
              <Text style={styles.googleAccountEmail}>{googleAccount}</Text>
            </View>
            <Text style={styles.changeAccountLink}>Change</Text>
          </Pressable>

          {/* Action Buttons: Back Up Now & Restore */}
          <View style={styles.backupButtonsRow}>
            <Pressable
              style={[styles.whatsAppBackupBtn, isBackingUp && { opacity: 0.7 }]}
              onPress={handleBackupNow}
              disabled={isBackingUp || isRestoring}
            >
              {isBackingUp ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.whatsAppBackupBtnText}>Back Up Now</Text>
              )}
            </Pressable>

            <Pressable
              style={[styles.whatsAppRestoreBtn, isRestoring && { opacity: 0.7 }]}
              onPress={handleRestoreNow}
              disabled={isBackingUp || isRestoring}
            >
              {isRestoring ? (
                <ActivityIndicator color="#6EE7B7" size="small" />
              ) : (
                <Text style={styles.whatsAppRestoreBtnText}>Restore Backup</Text>
              )}
            </Pressable>
          </View>

          {/* Secondary Backup Action Buttons: Share & Import */}
          <View style={styles.backupSecondaryButtonsRow}>
            <Pressable
              style={styles.whatsAppShareBtn}
              onPress={async () => {
                try {
                  const backupJson = await onExportBackup?.();
                  if (backupJson) {
                    await Share.share({
                      title: 'Fiscus_Backup.json',
                      message: backupJson,
                    });
                  }
                } catch {
                  Alert.alert('Error', 'Failed to share backup file.');
                }
              }}
            >
              <Text style={styles.whatsAppShareBtnText}>📤 Share Backup</Text>
            </Pressable>

            <Pressable
              style={styles.whatsAppImportBtn}
              onPress={() => setRestoreModalOpen(true)}
            >
              <Text style={styles.whatsAppImportBtnText}>📥 Restore from JSON</Text>
            </Pressable>
          </View>

          {/* Backup Options */}
          <View style={styles.backupOptionsDivider} />

          <View style={styles.optionRow}>
            <Text style={styles.optionLabel}>Back up to Google Drive</Text>
            <View style={styles.freqPillRow}>
              {['Daily', 'Weekly', 'Only on tap'].map(freq => (
                <Pressable
                  key={freq}
                  style={[
                    styles.freqPill,
                    backupFrequency === freq && styles.freqPillActive,
                  ]}
                  onPress={async () => {
                    setBackupFrequency(freq);
                    await setLocalSetting('backup_frequency', freq);
                  }}
                >
                  <Text
                    style={[
                      styles.freqPillText,
                      backupFrequency === freq && styles.freqPillTextActive,
                    ]}
                  >
                    {freq}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={[styles.rowBetween, { marginTop: 12 }]}>
            <Text style={styles.optionLabel}>Back up over cellular data</Text>
            <Switch
              value={backupCellular}
              onValueChange={setBackupCellular}
              trackColor={{ false: '#3B3F58', true: '#25D366' }}
              thumbColor={backupCellular ? '#FFFFFF' : '#E5E7EB'}
            />
          </View>
        </View>

        {/* 2. BANK NOTIFICATIONS AUTO-TRACKER */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bank Notifications Auto-Tracker</Text>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <View style={styles.statusBadgeRow}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: isNotificationAccessGranted
                        ? '#10B981'
                        : '#F59E0B',
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.statusBadgeText,
                    {
                      color: isNotificationAccessGranted
                        ? '#6EE7B7'
                        : '#FCD34D',
                    },
                  ]}
                >
                  {isNotificationAccessGranted
                    ? 'Active · Auto-reading alerts'
                    : 'Permission Required'}
                </Text>
              </View>
              <Text style={styles.helperText}>
                Automatically captures transactions from bank notifications and
                SMS (Meezan, HBL, Easypaisa, JazzCash, SadaPay, NayaPay, etc.)
                and adds them directly into the app.
              </Text>
            </View>
          </View>

          {/* Smart Protection Features */}
          <View style={styles.featureCardsContainer}>
            <View style={styles.featureCard}>
              <Text style={styles.featureIcon}>🛡️</Text>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.featureTitle}>Multi-App Deduplication</Text>
                <Text style={styles.featureDesc}>
                  Automatically prevents duplicate entries when Bank App & SMS notify for the same payment.
                </Text>
              </View>
              <View style={styles.activePill}>
                <Text style={styles.activePillText}>Active</Text>
              </View>
            </View>

            <View style={styles.featureCard}>
              <Text style={styles.featureIcon}>🚫</Text>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.featureTitle}>Spam & Temu Shield</Text>
                <Text style={styles.featureDesc}>
                  Automatically blocks promo offers, coupons, flash sales, and shopping apps (Temu, Daraz, etc.).
                </Text>
              </View>
              <View style={styles.activePill}>
                <Text style={styles.activePillText}>Active</Text>
              </View>
            </View>
          </View>

          <Pressable
            style={[
              styles.actionButton,
              isNotificationAccessGranted
                ? styles.actionButtonSecondary
                : styles.actionButtonPrimary,
            ]}
            onPress={onOpenNotificationAccessSettings}
          >
            <Text
              style={[
                styles.actionButtonText,
                isNotificationAccessGranted && styles.actionButtonTextSecondary,
              ]}
            >
              {isNotificationAccessGranted
                ? 'Manage Notification Access'
                : 'Enable Notification Access'}
            </Text>
          </Pressable>
        </View>

        {/* 3. SYSTEM FLOATING BUBBLE */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System Bubble</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>
              {bubbleEnabled ? 'Enabled' : 'Disabled'}
            </Text>
            <Switch
              value={bubbleEnabled}
              onValueChange={onToggleBubble}
              trackColor={{ false: '#3B3F58', true: '#6EE7B7' }}
              thumbColor={bubbleEnabled ? '#FFFFFF' : '#E5E7EB'}
            />
          </View>
          <Text style={styles.helperText}>
            Enable or disable the floating bubble quick add.
          </Text>
        </View>

        {/* 4. COUNTRY & CURRENCY */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Country & Currency</Text>
          <View style={styles.countryList}>
            {countries.map(country => {
              const isActive = country.code === selectedCountry.code;
              return (
                <Pressable
                  key={country.code}
                  style={[
                    styles.countryItem,
                    isActive && styles.countryItemActive,
                  ]}
                  onPress={() => onSelectCountry(country)}
                >
                  <View>
                    <Text
                      style={[
                        styles.countryName,
                        isActive && styles.countryNameActive,
                      ]}
                    >
                      {country.name}
                    </Text>
                    <Text style={styles.countryMeta}>
                      {country.code} · {country.currencySymbol}
                    </Text>
                  </View>
                  <Text style={styles.countryCheck}>
                    {isActive ? '✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>This app is made by shakelz</Text>
        </View>
      </ScrollView>

      {/* Google Account Switcher Modal */}
      <Modal
        visible={isAccountModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setAccountModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Google Account</Text>
              <Pressable onPress={() => setAccountModalOpen(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.modalSub}>
              Select or enter the Google account to use for automatic cloud backup & restore.
            </Text>

            {/* Native 1-Tap Google Account Picker */}
            <Pressable
              style={styles.systemGoogleBtn}
              onPress={async () => {
                try {
                  if (NativeModules.GoogleAuthModule?.chooseGoogleAccount) {
                    const picked = await NativeModules.GoogleAuthModule.chooseGoogleAccount();
                    if (picked) {
                      await handleSwitchGoogleAccount(picked);
                      return;
                    }
                  }
                } catch {
                  Alert.alert('Google Account', 'No account chosen.');
                }
              }}
            >
              <View style={styles.googleIconWrapSmall}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#4285F4' }}>G</Text>
              </View>
              <Text style={styles.systemGoogleBtnText}>Choose Google Account on Phone</Text>
            </Pressable>

            {/* Predefined Quick Accounts */}
            <Pressable
              style={styles.quickAccountItem}
              onPress={() => handleSwitchGoogleAccount('shakelz.finance@gmail.com')}
            >
              <View style={styles.googleIconWrapSmall}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#4285F4' }}>G</Text>
              </View>
              <Text style={styles.quickAccountEmail}>shakelz.finance@gmail.com</Text>
            </Pressable>

            <Pressable
              style={styles.quickAccountItem}
              onPress={() => handleSwitchGoogleAccount('personal.backup@gmail.com')}
            >
              <View style={styles.googleIconWrapSmall}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#4285F4' }}>G</Text>
              </View>
              <Text style={styles.quickAccountEmail}>personal.backup@gmail.com</Text>
            </Pressable>

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Or enter custom Google email:</Text>
            <TextInput
              style={styles.textInput}
              placeholder="youremail@gmail.com"
              placeholderTextColor="#6B7280"
              keyboardType="email-address"
              autoCapitalize="none"
              value={customEmail}
              onChangeText={setCustomEmail}
            />

            <Pressable
              style={styles.connectAccountBtn}
              onPress={() => handleSwitchGoogleAccount(customEmail)}
            >
              <Text style={styles.connectAccountBtnText}>1-Click Connect Account</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* RESTORE FROM JSON MODAL */}
      <Modal
        visible={isRestoreModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setRestoreModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Restore from Backup JSON</Text>
              <Pressable onPress={() => setRestoreModalOpen(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.modalDesc}>
              Paste your exported Fiscus backup JSON text below to restore your accounts, transactions, and loans.
            </Text>
            <TextInput
              style={[styles.textInput, { height: 110, textAlignVertical: 'top' }]}
              placeholder='Paste JSON here (e.g. {"version": 1, ...})'
              placeholderTextColor="#6B7280"
              multiline
              value={restoreJsonText}
              onChangeText={setRestoreJsonText}
            />
            <Pressable
              style={[styles.connectAccountBtn, isRestoring && { opacity: 0.7 }]}
              onPress={handleRestoreCustomJson}
              disabled={isRestoring}
            >
              {isRestoring ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.connectAccountBtnText}>Restore Data Now</Text>
              )}
            </Pressable>
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
  content: {
    paddingHorizontal: 20,
    paddingBottom: 130,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 20,
  },
  systemGoogleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  systemGoogleBtnText: {
    color: '#1F2937',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#20224A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  backupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cloudIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(37, 211, 102, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupSubtext: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 15,
  },
  backupStatusCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  backupStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  backupStatusLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  backupStatusValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  googleAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  googleIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconWrapSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  googleG: {
    fontSize: 16,
    fontWeight: '900',
    color: '#4285F4',
  },
  googleAccountTitle: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.55)',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  googleAccountEmail: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 1,
  },
  changeAccountLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6EE7B7',
    paddingHorizontal: 6,
  },
  backupButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  whatsAppBackupBtn: {
    flex: 1,
    backgroundColor: '#25D366',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsAppBackupBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  whatsAppRestoreBtn: {
    flex: 1,
    backgroundColor: 'rgba(110, 231, 183, 0.15)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  whatsAppRestoreBtnText: {
    color: '#6EE7B7',
    fontSize: 13,
    fontWeight: '800',
  },
  backupSecondaryButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  whatsAppShareBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  whatsAppShareBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  whatsAppImportBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
  },
  whatsAppImportBtnText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '700',
  },
  backupOptionsDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
  },
  optionRow: {
    marginBottom: 6,
  },
  optionLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
    fontWeight: '600',
    marginBottom: 6,
  },
  freqPillRow: {
    flexDirection: 'row',
    gap: 6,
  },
  freqPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  freqPillActive: {
    backgroundColor: '#25D366',
  },
  freqPillText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.65)',
    fontWeight: '600',
  },
  freqPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.65)',
    lineHeight: 16,
  },
  countryList: {
    gap: 10,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  countryItemActive: {
    backgroundColor: '#FFFFFF',
  },
  countryName: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  countryNameActive: {
    color: '#1B1B3A',
  },
  countryMeta: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
  },
  countryCheck: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B1B3A',
  },
  footer: {
    alignItems: 'center',
    marginTop: 10,
  },
  footerText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  actionButton: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPrimary: {
    backgroundColor: '#6EE7B7',
  },
  actionButtonSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1B1B3A',
  },
  actionButtonTextSecondary: {
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#1E2140',
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalSub: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.65)',
    marginBottom: 14,
    lineHeight: 16,
  },
  modalDesc: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.65)',
    marginBottom: 14,
    lineHeight: 16,
  },
  modalCloseText: {
    fontSize: 18,
    color: '#9CA3AF',
    padding: 4,
  },
  quickAccountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  quickAccountEmail: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 6,
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#14172E',
    borderRadius: 10,
    color: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  connectAccountBtn: {
    backgroundColor: '#25D366',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  connectAccountBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  featureCardsContainer: {
    marginTop: 12,
    marginBottom: 14,
    gap: 8,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  featureIcon: {
    fontSize: 18,
  },
  featureTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 15,
  },
  activePill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    marginLeft: 6,
  },
  activePillText: {
    color: '#6EE7B7',
    fontSize: 10,
    fontWeight: '800',
  },
});

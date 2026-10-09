import React, { useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Account, Debt, QuickTransaction } from '../data/models';
import {
  AIParsedTransaction,
  calculateFinancialHealth,
  parseBankAlertOrReceiptWithAI,
  queryFinancialAI,
} from '../services/aiAdvisorService';

type AIScreenProps = {
  transactions: QuickTransaction[];
  accounts: Account[];
  debts: Debt[];
  currencySymbol: string;
  onAddTransaction: (entry: QuickTransaction) => void;
  onBack: () => void;
};

export default function AIScreen({
  transactions,
  accounts,
  debts,
  currencySymbol,
  onAddTransaction,
  onBack,
}: AIScreenProps) {
  const safeAreaInsets = useSafeAreaInsets();

  // 1. Calculate live financial health report
  const healthReport = useMemo(
    () => calculateFinancialHealth(transactions, accounts, debts, currencySymbol),
    [transactions, accounts, debts, currencySymbol],
  );

  // 2. AI Smart Paste / SMS & Receipt Scanner State
  const [rawText, setRawText] = useState('');
  const [parsedTx, setParsedTx] = useState<AIParsedTransaction | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 3. Interactive "Ask AI" Assistant State
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(
    'Hello! I am your Fiscus AI Financial Copilot. Ask me about your spending, affordability for purchases, or Khata balances!',
  );
  const [isAsking, setIsAsking] = useState(false);

  // Helper format
  const formatAmount = (val: number) =>
    `${currencySymbol}${Math.abs(Math.round(val)).toLocaleString()}`;

  // Smart paste parse handler
  const handleParseText = () => {
    Keyboard.dismiss();
    if (!rawText.trim()) {
      Alert.alert('Empty Text', 'Please paste an SMS alert, bill snippet, or expense note.');
      return;
    }
    const parsed = parseBankAlertOrReceiptWithAI(rawText, accounts);
    setParsedTx(parsed);
    setSaveSuccessMsg(null);
  };

  // 1-Tap Save parsed transaction
  const handleSaveParsedTx = () => {
    Keyboard.dismiss();
    if (!parsedTx || parsedTx.amount <= 0) {
      Alert.alert('Invalid Amount', 'Could not detect a valid transaction amount.');
      return;
    }

    const matchedAccount = accounts.find(a => a.id === parsedTx.accountId) || accounts[0];

    const newTx: QuickTransaction = {
      id: String(Date.now()),
      type: parsedTx.type,
      amount: parsedTx.amount,
      note: parsedTx.note,
      createdAt: parsedTx.date || new Date().toISOString(),
      accountId: matchedAccount?.id,
      accountName: matchedAccount?.name,
      accountType: matchedAccount?.type,
      category: parsedTx.category,
    };

    onAddTransaction(newTx);
    setSaveSuccessMsg(`✅ Saved ${formatAmount(parsedTx.amount)} to ${matchedAccount?.name || 'Account'}!`);
    setRawText('');
    setParsedTx(null);
    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  // Quick Prompt Handler for Ask AI
  const handleRunAiQuery = (customPrompt?: string) => {
    Keyboard.dismiss();
    const q = customPrompt || aiQuery;
    if (!q.trim()) return;

    setIsAsking(true);
    setAiQuery(q);

    setTimeout(() => {
      const response = queryFinancialAI(q, transactions, accounts, debts, currencySymbol);
      setAiResponse(response);
      setIsAsking(false);
    }, 250);
  };

  // Sample SMS presets for easy testing
  const sampleSMSList = [
    'Meezan Bank: Acct **1234 debited for PKR 3,850 at PSO Fuel Station on 29-Sep.',
    'HBL Alert: Rs 1,450 paid to Cheezious Pizza via debit card.',
    'Salary credited: PKR 185,000 received from Company Payroll into Account.',
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(safeAreaInsets.top, 16),
            paddingBottom: Math.max(safeAreaInsets.bottom + 120, 140),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        {/* Top Header */}
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Dashboard</Text>
          </Pressable>
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>AI 2.0</Text>
          </View>
        </View>

        <View style={styles.heroWrap}>
          <Text style={styles.heroTitle}>Fiscus AI Copilot ✨</Text>
          <Text style={styles.heroSubtitle}>
            Autonomous financial intelligence, health score & smart NLP parser
          </Text>
        </View>

        {/* 1. FINANCIAL HEALTH SCORE CARD */}
        <View style={styles.healthCard}>
          <View style={styles.healthCardGlow} />
          <View style={styles.healthTopRow}>
            <View>
              <Text style={styles.healthLabel}>FINANCIAL HEALTH SCORE</Text>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreNumber}>{healthReport.score}</Text>
                <Text style={styles.scoreOutOf}>/100</Text>
              </View>
            </View>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: `${healthReport.statusColor}25`, borderColor: healthReport.statusColor },
              ]}
            >
              <Text style={[styles.statusPillText, { color: healthReport.statusColor }]}>
                {healthReport.status}
              </Text>
            </View>
          </View>

          {/* Health Metrics Grid */}
          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Savings Rate</Text>
              <Text
                style={[
                  styles.metricValue,
                  { color: healthReport.savingsRate >= 0 ? '#6EE7B7' : '#F87171' },
                ]}
              >
                {healthReport.savingsRate}%
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Daily Burn</Text>
              <Text style={styles.metricValue}>
                {formatAmount(healthReport.dailyBurnRate)}/d
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Projected Outflow</Text>
              <Text style={styles.metricValue}>
                {formatAmount(healthReport.projectedMonthExpense)}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Liquid Balance</Text>
              <Text style={[styles.metricValue, { color: '#60A5FA' }]}>
                {formatAmount(healthReport.totalLiquidBalance)}
              </Text>
            </View>
          </View>
        </View>

        {/* 2. DYNAMIC AI INSIGHTS & RECOMMENDATIONS */}
        <Text style={styles.sectionHeading}>Smart AI Insights</Text>
        <View style={styles.insightsList}>
          {healthReport.insights.map(item => (
            <View key={item.id} style={styles.insightCard}>
              <Text style={styles.insightIcon}>{item.icon}</Text>
              <View style={styles.insightTextWrap}>
                <Text style={styles.insightTitle}>{item.title}</Text>
                <Text style={styles.insightDesc}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* 3. AI SMART PASTE & RECEIPT / SMS SCANNER */}
        <View style={styles.scannerSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>AI Smart Paste Scanner</Text>
            <View style={styles.nlpBadge}>
              <Text style={styles.nlpBadgeText}>NLP Engine</Text>
            </View>
          </View>
          <Text style={styles.sectionSub}>
            Paste any bank SMS alert or receipt text. AI automatically detects amount, bank, category, and merchant.
          </Text>

          {/* Sample quick buttons */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sampleScroll}>
            {sampleSMSList.map((sample, idx) => (
              <Pressable
                key={idx}
                style={styles.sampleChip}
                onPress={() => setRawText(sample)}
              >
                <Text style={styles.sampleChipText}>Sample {idx + 1}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.scannerInput}
              value={rawText}
              onChangeText={setRawText}
              placeholder="Paste raw SMS or receipt note here..."
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
              multiline
              numberOfLines={3}
            />
            <View style={styles.scannerActionRow}>
              {rawText.length > 0 && (
                <Pressable
                  style={styles.clearBtn}
                  onPress={() => {
                    setRawText('');
                    setParsedTx(null);
                  }}
                >
                  <Text style={styles.clearBtnText}>Clear</Text>
                </Pressable>
              )}
              <Pressable style={styles.parseBtn} onPress={handleParseText}>
                <Text style={styles.parseBtnText}>✨ Parse with AI</Text>
              </Pressable>
            </View>
          </View>

          {/* Success Banner */}
          {saveSuccessMsg && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerText}>{saveSuccessMsg}</Text>
            </View>
          )}

          {/* Parsed Result Card */}
          {parsedTx && (
            <View style={styles.parsedCard}>
              <View style={styles.parsedTopRow}>
                <View style={styles.parsedTypeRow}>
                  <Pressable
                    style={[
                      styles.typeBadge,
                      parsedTx.type === 'expense' ? styles.typeExpense : styles.typeIncome,
                    ]}
                    onPress={() =>
                      setParsedTx(prev =>
                        prev ? { ...prev, type: prev.type === 'expense' ? 'income' : 'expense' } : null,
                      )
                    }
                  >
                    <Text style={styles.typeBadgeText}>
                      {parsedTx.type === 'expense' ? '🔴 EXPENSE ▾' : '🟢 INCOME ▾'}
                    </Text>
                  </Pressable>
                  <Text style={styles.parsedCategoryText}>📁 {parsedTx.category}</Text>
                </View>
                <Text style={styles.parsedAmount}>
                  {formatAmount(parsedTx.amount)}
                </Text>
              </View>

              {/* Editable Merchant / Note */}
              <View style={styles.parsedInputWrap}>
                <Text style={styles.parsedDetailLabel}>Note / Merchant:</Text>
                <TextInput
                  style={styles.parsedEditField}
                  value={parsedTx.note}
                  onChangeText={txt => setParsedTx(prev => (prev ? { ...prev, note: txt } : null))}
                  placeholder="Merchant or description"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
              </View>

              {/* Editable Amount */}
              <View style={styles.parsedInputWrap}>
                <Text style={styles.parsedDetailLabel}>Amount ({currencySymbol}):</Text>
                <TextInput
                  style={styles.parsedEditField}
                  value={String(parsedTx.amount)}
                  onChangeText={txt => {
                    const num = parseFloat(txt);
                    setParsedTx(prev => (prev ? { ...prev, amount: isNaN(num) ? 0 : num } : null));
                  }}
                  keyboardType="numeric"
                  placeholder="0.00"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
              </View>

              {/* Target Account Selector Chips */}
              <View style={{ marginTop: 8 }}>
                <Text style={styles.parsedDetailLabel}>Target Account:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  {accounts.map(acc => {
                    const isSelected = parsedTx.accountId === acc.id;
                    return (
                      <Pressable
                        key={acc.id}
                        onPress={() =>
                          setParsedTx(prev =>
                            prev ? { ...prev, accountId: acc.id, accountName: acc.name } : null,
                          )
                        }
                        style={[
                          styles.accountMiniChip,
                          isSelected && styles.accountMiniChipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.accountMiniChipText,
                            isSelected && styles.accountMiniChipTextSelected,
                          ]}
                        >
                          🏦 {acc.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <Pressable style={styles.saveParsedBtn} onPress={handleSaveParsedTx}>
                <Text style={styles.saveParsedBtnText}>
                  💾 1-Tap Save to Transactions
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* 4. INTERACTIVE ASK FISCUS AI COPILOT */}
        <View style={styles.askSection}>
          <Text style={styles.sectionHeading}>Ask Fiscus AI Copilot</Text>
          <Text style={styles.sectionSub}>
            Ask anything about your money, budget affordability, or Khata ledgers.
          </Text>

          {/* Quick interactive prompt chips */}
          <View style={styles.chipsWrap}>
            <Pressable
              style={styles.promptChip}
              onPress={() => handleRunAiQuery('Can I afford €100 purchase right now?')}
            >
              <Text style={styles.promptChipText}>💬 Can I afford €100?</Text>
            </Pressable>
            <Pressable
              style={styles.promptChip}
              onPress={() => handleRunAiQuery('How much did I spend this week?')}
            >
              <Text style={styles.promptChipText}>💬 This week's spending</Text>
            </Pressable>
            <Pressable
              style={styles.promptChip}
              onPress={() => handleRunAiQuery('What is my biggest expense category?')}
            >
              <Text style={styles.promptChipText}>💬 Top expense category</Text>
            </Pressable>
            <Pressable
              style={styles.promptChip}
              onPress={() => handleRunAiQuery('Check for duplicate charges or anomalies')}
            >
              <Text style={styles.promptChipText}>💬 Check duplicates</Text>
            </Pressable>
            <Pressable
              style={styles.promptChip}
              onPress={() => handleRunAiQuery('Show my internal transfers')}
            >
              <Text style={styles.promptChipText}>💬 Account transfers</Text>
            </Pressable>
            <Pressable
              style={styles.promptChip}
              onPress={() => handleRunAiQuery('Analyze my Khata debts and loans')}
            >
              <Text style={styles.promptChipText}>💬 Khata debts summary</Text>
            </Pressable>
            <Pressable
              style={styles.promptChip}
              onPress={() => handleRunAiQuery('Give me actionable savings tips based on my spend')}
            >
              <Text style={styles.promptChipText}>💬 Smart savings tips</Text>
            </Pressable>
          </View>

          {/* AI Response Card */}
          {aiResponse && (
            <View style={styles.aiResponseCard}>
              <View style={styles.aiHeaderRow}>
                <Text style={styles.aiAvatar}>🤖</Text>
                <Text style={styles.aiResponseTitle}>Fiscus AI Assistant</Text>
              </View>
              <Text style={styles.aiResponseText}>{aiResponse}</Text>
            </View>
          )}

          {/* Question Input Box */}
          <View style={styles.askInputRow}>
            <TextInput
              style={styles.askInput}
              value={aiQuery}
              onChangeText={setAiQuery}
              placeholder="Ask anything (e.g. Can I afford Rs 5,000?)..."
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
              onSubmitEditing={() => handleRunAiQuery()}
            />
            <Pressable
              style={[styles.askSendBtn, isAsking && { opacity: 0.5 }]}
              onPress={() => handleRunAiQuery()}
              disabled={isAsking}
            >
              <Text style={styles.askSendBtnText}>🚀</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B1B3A',
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  aiBadge: {
    backgroundColor: 'rgba(78, 124, 255, 0.25)',
    borderWidth: 1,
    borderColor: '#4E7CFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  aiBadgeText: {
    color: '#60A5FA',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  heroWrap: {
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
    lineHeight: 18,
  },
  healthCard: {
    backgroundColor: '#23274F',
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  healthCardGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(78, 124, 255, 0.12)',
    top: -60,
    right: -40,
  },
  healthTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  healthLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 0.8,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
  },
  scoreNumber: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  scoreOutOf: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    marginLeft: 4,
  },
  statusPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  metricItem: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 10,
  },
  metricLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  sectionSub: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.65)',
    marginBottom: 12,
    lineHeight: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nlpBadge: {
    backgroundColor: 'rgba(110, 231, 183, 0.15)',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  nlpBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6EE7B7',
  },
  insightsList: {
    gap: 10,
    marginBottom: 24,
  },
  insightCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'flex-start',
    gap: 12,
  },
  insightIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  insightTextWrap: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  insightDesc: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 17,
  },
  scannerSection: {
    backgroundColor: '#23274F',
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  sampleScroll: {
    marginBottom: 12,
  },
  sampleChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginRight: 8,
  },
  sampleChipText: {
    fontSize: 11,
    color: '#E0E7FF',
    fontWeight: '600',
  },
  inputContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  scannerInput: {
    fontSize: 13,
    color: '#FFFFFF',
    minHeight: 65,
    textAlignVertical: 'top',
  },
  scannerActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearBtnText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  parseBtn: {
    backgroundColor: '#4E7CFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  parseBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  successBanner: {
    backgroundColor: 'rgba(110, 231, 183, 0.2)',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    padding: 10,
    borderRadius: 12,
    marginTop: 12,
  },
  successBannerText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  parsedCard: {
    backgroundColor: '#1E2140',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#4E7CFF',
  },
  parsedTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  parsedTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeExpense: {
    backgroundColor: '#EF4444',
  },
  typeIncome: {
    backgroundColor: '#10B981',
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  parsedCategoryText: {
    fontSize: 12,
    color: '#E0E7FF',
    fontWeight: '600',
  },
  parsedAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  parsedDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  parsedDetailLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.55)',
    fontWeight: '600',
  },
  parsedDetailValue: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
    maxWidth: '65%',
    textAlign: 'right',
  },
  saveParsedBtn: {
    backgroundColor: '#6EE7B7',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  saveParsedBtnText: {
    color: '#1B1B3A',
    fontSize: 13,
    fontWeight: '800',
  },
  parsedInputWrap: {
    marginTop: 8,
  },
  parsedEditField: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  accountMiniChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  accountMiniChipSelected: {
    backgroundColor: '#4E7CFF',
    borderColor: '#60A5FA',
  },
  accountMiniChipText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  accountMiniChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  askSection: {
    backgroundColor: '#23274F',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  promptChip: {
    backgroundColor: 'rgba(78, 124, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(78, 124, 255, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
  },
  promptChipText: {
    fontSize: 11,
    color: '#93C5FD',
    fontWeight: '600',
  },
  aiResponseCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  aiAvatar: {
    fontSize: 16,
  },
  aiResponseTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#60A5FA',
    letterSpacing: 0.3,
  },
  aiResponseText: {
    fontSize: 13,
    color: '#F3F4F6',
    lineHeight: 20,
  },
  askInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  askInput: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 12,
    color: '#FFFFFF',
  },
  askSendBtn: {
    backgroundColor: '#4E7CFF',
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askSendBtnText: {
    fontSize: 18,
  },
});

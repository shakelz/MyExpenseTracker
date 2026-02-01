import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { curveMonotoneX, line as d3Line } from 'd3-shape';
import { Account, QuickTransaction } from '../data/models';

const formatCurrency = (symbol: string, value: number) =>
  `${symbol}${value.toFixed(2)}`;
const chartHeight = 160;

const getMonthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

const monthLabel = (index: number, withYear = false) => {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return new Date(year, month, 1).toLocaleString('en-GB',
    withYear ? { month: 'short', year: 'numeric' } : { month: 'short' },
  );
};

export default function AnalysisScreen({
  transactions,
  accounts,
  currencySymbol,
  onBack,
}: {
  transactions: QuickTransaction[];
  accounts: Account[];
  currencySymbol: string;
  onBack: () => void;
}) {
  const today = useMemo(() => new Date(), []);
  const { width } = useWindowDimensions();
  const baseMonthIndex = useMemo(() => getMonthIndex(today), [today]);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(baseMonthIndex);
  const [isMonthDropdownOpen, setMonthDropdownOpen] = useState(false);

  const monthOptions = useMemo(() => {
    const count = 12;
    return Array.from({ length: count }, (_, idx) =>
      baseMonthIndex - (count - 1 - idx),
    );
  }, [baseMonthIndex]);

  const analysis = useMemo(() => {
    const currentMonthIndex = selectedMonthIndex;
    const previousMonthIndex = selectedMonthIndex - 1;

    let currentIncome = 0;
    let currentExpense = 0;
    let previousIncome = 0;
    let previousExpense = 0;
    const expenseByCategory: Record<string, number> = {};
    const incomeBySource: Record<string, number> = {};

    const year = Math.floor(currentMonthIndex / 12);
    const month = currentMonthIndex % 12;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayBuckets = Array.from({ length: daysInMonth }, (_, idx) => ({
      day: idx + 1,
      income: 0,
      expense: 0,
    }));

    transactions.forEach(item => {
      const date = new Date(item.createdAt);
      const monthIndex = getMonthIndex(date);

      if (monthIndex === currentMonthIndex) {
        const dayIndex = date.getDate() - 1;
        if (item.type === 'income') {
          currentIncome += item.amount;
          if (dayBuckets[dayIndex]) {
            dayBuckets[dayIndex].income += item.amount;
          }
          const source =
            item.category?.trim() ||
            item.note?.trim() ||
            item.accountName?.trim() ||
            'Other';
          incomeBySource[source] = (incomeBySource[source] ?? 0) + item.amount;
        } else {
          currentExpense += item.amount;
          if (dayBuckets[dayIndex]) {
            dayBuckets[dayIndex].expense += item.amount;
          }
          const category = item.category?.trim() || 'Other';
          expenseByCategory[category] =
            (expenseByCategory[category] ?? 0) + item.amount;
        }
        return;
      }

      if (monthIndex === previousMonthIndex) {
        if (item.type === 'income') {
          previousIncome += item.amount;
        } else {
          previousExpense += item.amount;
        }
      }
    });

    const currentNet = currentIncome - currentExpense;
    const previousNet = previousIncome - previousExpense;
    const expenseChangePct =
      previousExpense > 0
        ? (currentExpense - previousExpense) / previousExpense
        : null;
    const netChangePct =
      previousNet !== 0
        ? (currentNet - previousNet) / Math.abs(previousNet)
        : null;

    const expenseCategories = Object.entries(expenseByCategory).sort(
      (a, b) => a[1] - b[1],
    );
    const incomeSources = Object.entries(incomeBySource).sort(
      (a, b) => a[1] - b[1],
    );

    const maxDaily = Math.max(
      1,
      ...dayBuckets.flatMap(entry => [entry.income, entry.expense]),
    );

    return {
      currentIncome,
      currentExpense,
      currentNet,
      expenseChangePct,
      netChangePct,
      expenseCategories,
      incomeSources,
      dayBuckets,
      maxDaily,
    };
  }, [selectedMonthIndex, transactions]);

  const selectedMonthLabel = monthLabel(selectedMonthIndex, true);
  const expenseChangeLabel = analysis.expenseChangePct === null
    ? 'No data last month'
    : `${analysis.expenseChangePct > 0 ? '+' : ''}${Math.round(
        analysis.expenseChangePct * 100,
      )}% vs last month`;
  const netChangeLabel = analysis.netChangePct === null
    ? 'No data last month'
    : `${analysis.netChangePct > 0 ? '+' : ''}${Math.round(
        analysis.netChangePct * 100,
      )}% vs last month`;

  const incomeSeries = analysis.dayBuckets.map(entry => entry.income);
  const expenseSeries = analysis.dayBuckets.map(entry => entry.expense);
  const chartWidth = Math.max(0, width - 40);
  const maxDaily = Math.max(1, analysis.maxDaily);
  const pointCount = analysis.dayBuckets.length;

  const getPoints = (values: number[]) =>
    values.map((value, index) => ({
      x: pointCount <= 1 ? 0 : (index / (pointCount - 1)) * chartWidth,
      y: chartHeight - (value / maxDaily) * chartHeight,
      value,
    }));

  const incomePoints = getPoints(incomeSeries);
  const expensePoints = getPoints(expenseSeries);
  const clampY = (value: number) => Math.min(chartHeight - 10, Math.max(10, value));
  const clampX = (value: number) => Math.min(chartWidth - 6, Math.max(6, value));

  const buildSegments = (points: { x: number; y: number; value: number }[]) => {
    const segments: Array<typeof points> = [];
    let current: typeof points = [];
    points.forEach(point => {
      if (point.value > 0) {
        current.push({ ...point, y: clampY(point.y) });
      } else if (current.length) {
        segments.push(current);
        current = [];
      }
    });
    if (current.length) segments.push(current);
    return segments;
  };

  const incomeSegments = buildSegments(incomePoints);
  const expenseSegments = buildSegments(expensePoints);
  const incomeDisplayPoints = incomeSegments.flat();
  const expenseDisplayPoints = expenseSegments.flat();
  const labelPoints = analysis.dayBuckets
    .map((entry, index) => ({
      day: entry.day,
      x: clampX(incomePoints[index]?.x ?? 0),
      hasData: entry.income > 0 || entry.expense > 0,
    }))
    .filter(entry => entry.hasData);

  const lineGenerator = d3Line<{ x: number; y: number }>()
    .x((point: { x: number; y: number }) => point.x)
    .y((point: { x: number; y: number }) => point.y)
    .curve(curveMonotoneX);

  const incomePaths = incomeSegments.map(segment => lineGenerator(segment) ?? '');
  const expensePaths = expenseSegments.map(segment => lineGenerator(segment) ?? '');

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerTitle}>Insights</Text>
            <Text style={styles.headerSubtitle}>
              Monthly summary · {selectedMonthLabel}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Month</Text>
          <Pressable
            style={styles.dropdownTrigger}
            onPress={() => setMonthDropdownOpen(open => !open)}
          >
            <Text style={styles.dropdownText}>{selectedMonthLabel}</Text>
            <Text style={styles.dropdownCaret}>
              {isMonthDropdownOpen ? '▲' : '▼'}
            </Text>
          </Pressable>
          {isMonthDropdownOpen && (
            <View style={styles.dropdownMenu}>
              {monthOptions.map(index => {
                const label = monthLabel(index, true);
                const isActive = index === selectedMonthIndex;
                return (
                  <Pressable
                    key={index}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setSelectedMonthIndex(index);
                      setMonthDropdownOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        isActive && styles.dropdownItemTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Monthly Expense</Text>
            <Text style={styles.metricValue}>
              {formatCurrency(currencySymbol, analysis.currentExpense)}
            </Text>
            <Text
              style={[
                styles.changeText,
                analysis.expenseChangePct === null
                  ? styles.changeMuted
                  : analysis.expenseChangePct <= 0
                    ? styles.deltaPositive
                    : styles.deltaNegative,
              ]}
            >
              {expenseChangeLabel}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Monthly Profit</Text>
            <Text style={styles.metricValue}>
              {analysis.currentNet >= 0 ? '+' : '-'}
              {formatCurrency(currencySymbol, Math.abs(analysis.currentNet))}
            </Text>
            <Text
              style={[
                styles.changeText,
                analysis.netChangePct === null
                  ? styles.changeMuted
                  : analysis.netChangePct >= 0
                    ? styles.deltaPositive
                    : styles.deltaNegative,
              ]}
            >
              {netChangeLabel}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Income vs Expense</Text>
          <View style={styles.lineChartCard}>
            <Svg width={chartWidth} height={chartHeight}>
              {incomePaths.map((path, index) => (
                <Path
                  key={`income-path-${index}`}
                  d={path}
                  stroke="#6EE7B7"
                  strokeWidth={2}
                  fill="none"
                />
              ))}
              {expensePaths.map((path, index) => (
                <Path
                  key={`expense-path-${index}`}
                  d={path}
                  stroke="#FF8A80"
                  strokeWidth={2}
                  fill="none"
                />
              ))}
              {incomeDisplayPoints.map((point, index) => (
                <Circle
                  key={`income-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={3}
                  fill="#6EE7B7"
                />
              ))}
              {expenseDisplayPoints.map((point, index) => (
                <Circle
                  key={`expense-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={3}
                  fill="#FF8A80"
                />
              ))}
              {incomeDisplayPoints.map((point, index) => (
                <SvgText
                  key={`income-text-${index}`}
                  x={clampX(point.x)}
                  y={Math.max(12, point.y - 12)}
                  fontSize={9}
                  fill="#6EE7B7"
                  textAnchor="middle"
                >
                  {`${currencySymbol}${Math.round(point.value)}`}
                </SvgText>
              ))}
              {expenseDisplayPoints.map((point, index) => (
                <SvgText
                  key={`expense-text-${index}`}
                  x={clampX(point.x)}
                  y={Math.max(12, point.y - 12)}
                  fontSize={9}
                  fill="#FF8A80"
                  textAnchor="middle"
                >
                  {`${currencySymbol}${Math.round(point.value)}`}
                </SvgText>
              ))}
            </Svg>
          </View>
          <View style={styles.dateLabelRow}>
            {labelPoints.map(point => (
              <Text
                key={`label-${point.day}`}
                style={[styles.dateLabel, { left: point.x - 6 }]}
              >
                {point.day}
              </Text>
            ))}
          </View>
          <View style={styles.lineLegendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.legendIncome]} />
              <Text style={styles.legendText}>Income</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.legendExpense]} />
              <Text style={styles.legendText}>Expense</Text>
            </View>
          </View>
        </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Category-wise Expenses</Text>
        {analysis.expenseCategories.length === 0 ? (
          <Text style={styles.emptyText}>No expenses this month.</Text>
        ) : (
          analysis.expenseCategories.map(([category, amount]) => (
            <View key={category} style={styles.categoryRow}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryName}>{category}</Text>
                <Text style={styles.categoryAmount}>
                  {formatCurrency(currencySymbol, amount)}
                </Text>
              </View>
              <View style={styles.categoryBarTrack}>
                <View
                  style={[
                    styles.categoryBar,
                    {
                      width: `${Math.max(
                        6,
                        (amount / Math.max(1, analysis.currentExpense)) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Category-wise Income</Text>
        {analysis.incomeSources.length === 0 ? (
          <Text style={styles.emptyText}>No income this month.</Text>
        ) : (
          analysis.incomeSources.map(([source, amount]) => (
            <View key={source} style={styles.categoryRow}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryName}>{source}</Text>
                <Text style={styles.categoryAmount}>
                  {formatCurrency(currencySymbol, amount)}
                </Text>
              </View>
              <View style={styles.categoryBarTrack}>
                <View
                  style={[
                    styles.categoryBar,
                    styles.incomeBar,
                    {
                      width: `${Math.max(
                        6,
                        (amount / Math.max(1, analysis.currentIncome)) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Spending (Ascending)</Text>
        {analysis.expenseCategories.length === 0 ? (
          <Text style={styles.emptyText}>No expenses this month.</Text>
        ) : (
          analysis.expenseCategories.map(([category, amount]) => (
            <View key={`${category}-top`} style={styles.categoryRow}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryName}>{category}</Text>
                <Text style={styles.categoryAmount}>
                  {formatCurrency(currencySymbol, amount)}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Main Income Source (Ascending)</Text>
        {analysis.incomeSources.length === 0 ? (
          <Text style={styles.emptyText}>No income this month.</Text>
        ) : (
          analysis.incomeSources.map(([source, amount]) => (
            <View key={`${source}-top`} style={styles.categoryRow}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryName}>{source}</Text>
                <Text style={styles.categoryAmount}>
                  {formatCurrency(currencySymbol, amount)}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B1B3A',
    paddingTop: 18,
    paddingBottom: 0,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 140,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  dropdownText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  dropdownCaret: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  dropdownMenu: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#20224A',
    paddingVertical: 6,
  },
  dropdownItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  dropdownItemText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  dropdownItemTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#20224A',
    borderRadius: 16,
    padding: 14,
  },
  metricLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 8,
  },
  metricSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 6,
  },
  changeText: {
    fontSize: 11,
    marginTop: 6,
    fontWeight: '600',
  },
  changeMuted: {
    color: 'rgba(255,255,255,0.6)',
  },
  categoryRow: {
    marginBottom: 12,
  },
  deltaPositive: {
    color: '#6EE7B7',
  },
  deltaNegative: {
    color: '#FF8A80',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  categoryName: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  categoryAmount: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  categoryBarTrack: {
    height: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginTop: 6,
  },
  categoryBar: {
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 6,
  },
  incomeBar: {
    backgroundColor: '#6EE7B7',
  },
  lineChartCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 12,
    height: chartHeight,
  },
  dateLabelRow: {
    position: 'relative',
    height: 14,
    marginTop: 6,
  },
  dateLabel: {
    position: 'absolute',
    fontSize: 9,
    color: 'rgba(255,255,255,0.6)',
  },
  lineLegendRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendIncome: {
    backgroundColor: '#6EE7B7',
  },
  legendExpense: {
    backgroundColor: '#FF8A80',
  },
  legendText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  detailText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
});

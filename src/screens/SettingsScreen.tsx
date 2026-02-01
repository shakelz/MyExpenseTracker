import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

export type CountryOption = {
  name: string;
  code: string;
  currencySymbol: string;
};

export default function SettingsScreen({
  countries,
  selectedCountry,
  onSelectCountry,
  bubbleEnabled,
  onToggleBubble,
}: {
  countries: CountryOption[];
  selectedCountry: CountryOption;
  onSelectCountry: (country: CountryOption) => void;
  bubbleEnabled: boolean;
  onToggleBubble: (next: boolean) => void;
}) {
  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>Settings</Text>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B1B3A',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 90,
  },
  content: {
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 20,
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#20224A',
    borderRadius: 16,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
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
    color: 'rgba(255,255,255,0.65)',
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
    backgroundColor: 'rgba(255,255,255,0.06)',
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
    color: 'rgba(255,255,255,0.6)',
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
    color: 'rgba(255,255,255,0.6)',
  },
});

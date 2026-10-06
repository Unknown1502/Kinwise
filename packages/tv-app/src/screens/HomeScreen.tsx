import React, {useEffect, useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {isScreenReaderOn} from '../a11y/screenReader';
import {Card, EmptyLine} from '../components/Card';
import {Focusable} from '../components/Focusable';
import {FocusButton} from '../components/FocusButton';
import {StatusPill} from '../components/StatusPill';
import {useLocalClock} from '../hooks/useLocalClock';
import {plural, statusPill} from '../logic/copy';
import {SAFE, colors, s, type} from '../theme/theme';
import type {TvStateView} from '../types';

export const MAX_HOME_MESSAGES = 3;

export interface HomeScreenProps {
  state: TvStateView;
  /** Local time the state arrived (for the locally ticking clock). */
  receivedAt: number;
  /** False while an interactive overlay owns the remote. */
  active: boolean;
  busyKey?: string | null;
  onPrivacy: () => void;
  onOpenSettings: () => void;
  onReadMessage: (id: string) => void;
}

/** "Today at Home": the calm, ambient board the TV shows most of the time. */
export function HomeScreen({state, receivedAt, active, busyKey, onPrivacy, onOpenSettings, onReadMessage}: HomeScreenProps) {
  const {today} = state;
  const clock = useLocalClock({label: today.timeLabel, serverTime: state.serverTime, receivedAt});
  const pill = statusPill(state);
  const reminders = today.reminders ?? [];
  const messages = today.messages.slice(0, MAX_HOME_MESSAGES);
  const hiddenMessages = today.messages.length - messages.length;
  const unread = today.messages.filter((m) => m.unread).length;
  const privacyOn = Boolean(today.privacyHourUntilLabel);

  const summary = useMemo(
    () =>
      [
        `Today at Home. ${today.timeLabel}, ${today.dateLabel}.`,
        `${pill.text}.`,
        today.visits.length ? `${plural(today.visits.length, 'expected visitor', 'expected visitors')} today.` : 'No visitors expected today.',
        unread ? `${plural(unread, 'new message', 'new messages')} from family.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    // Only re-announce when the gist changes, not every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pill.text, today.visits.length, unread],
  );

  useEffect(() => {
    if (isScreenReaderOn()) announce(summary);
  }, [summary]);

  return (
    <SpatialNavigationRoot isActive={active}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={type.small}>{today.householdName}</Text>
            <Text style={type.title} accessibilityRole="header">
              Today at Home
            </Text>
          </View>
          <StatusPill pill={pill} />
        </View>

        <View
          style={styles.clockRow}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${clock}, ${today.dateLabel}`}>
          <Text style={type.clock}>{clock}</Text>
          <Text style={[type.lead, styles.date]}>{today.dateLabel}</Text>
        </View>

        <SpatialNavigationView direction="horizontal" style={styles.cards}>
          <Card title="Expected visitors" style={styles.card}>
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel={
                today.visits.length
                  ? `Expected visitors today: ${today.visits.map((v) => `${v.label}, ${v.timeLabel}`).join('; ')}`
                  : 'No visitors expected today'
              }>
              {today.visits.length === 0 ? <EmptyLine>No visitors expected today.</EmptyLine> : null}
              {today.visits.map((v) => (
                <View key={v.id} style={styles.item}>
                  <Text style={type.small}>{v.timeLabel}</Text>
                  <Text style={type.bodyStrong} numberOfLines={2}>
                    {v.label}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Card title="Reminders" style={styles.card}>
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel={
                reminders.length
                  ? `Reminders today: ${reminders
                      .map((r) => `${r.timeLabel}, ${r.text}${r.flagged ? ', Kinwise checked this one' : ''}`)
                      .join('; ')}`
                  : 'No reminders today'
              }>
              {reminders.length === 0 ? <EmptyLine>No reminders today.</EmptyLine> : null}
              {reminders.slice(0, 4).map((r) => (
                <View key={r.id} style={styles.item}>
                  <View style={styles.reminderTop}>
                    <Text style={type.small}>{r.timeLabel}</Text>
                    {r.flagged ? (
                      <View style={styles.checkedTag}>
                        <Text style={[type.smallStrong, styles.checkedText]}>checked</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={type.body} numberOfLines={2}>
                    {r.text}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Card title="Messages from family" style={[styles.card, styles.cardLast]}>
            {/* Always-present node so focus order stays stable as messages arrive. */}
            <DefaultFocus enable={messages.length > 0}>
              <SpatialNavigationView direction="vertical">
                {messages.length === 0 ? <EmptyLine>No messages yet.</EmptyLine> : null}
                {messages.map((m, index) => (
                  <Focusable
                    key={index}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.unread ? 'New message' : 'Message'} from ${m.from}, ${m.timeLabel}: ${m.text}`}
                    accessibilityHint={m.unread ? 'Select to mark it as read' : undefined}
                    busy={busyKey === `msg:${m.id}`}
                    onSelect={() => (m.unread ? onReadMessage(m.id) : announce(`${m.from} said: ${m.text}`))}
                    style={styles.messageOuter}
                    radius={s(20)}>
                    {(focused) => (
                      <View style={[styles.message, m.unread ? styles.messageUnread : null, focused ? styles.messageFocused : null]}>
                        <View style={styles.messageTop}>
                          <Text style={[type.smallStrong, focused ? styles.onLightMuted : null]}>
                            {m.from} · {m.timeLabel}
                          </Text>
                          {m.unread ? (
                            <View style={styles.newTag}>
                              <Text style={[type.smallStrong, styles.newTagText]}>New</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={[type.body, focused ? styles.onLight : null]} numberOfLines={2}>
                          {m.text}
                        </Text>
                      </View>
                    )}
                  </Focusable>
                ))}
                {hiddenMessages > 0 ? <Text style={type.small}>{`+${hiddenMessages} older`}</Text> : null}
              </SpatialNavigationView>
            </DefaultFocus>
          </Card>
        </SpatialNavigationView>

        <View style={styles.footer}>
          <SpatialNavigationView direction="horizontal" style={styles.actions}>
            <FocusButton
              label={privacyOn ? 'End privacy time' : 'Privacy time · 1 hour'}
              accessibilityHint={
                privacyOn
                  ? 'Kinwise goes back to noticing the door'
                  : 'For one hour Kinwise will not notice the door or keep any door activity'
              }
              busy={busyKey === 'privacy'}
              onSelect={onPrivacy}
              style={styles.actionGap}
            />
            <DefaultFocus enable={messages.length === 0}>
              <FocusButton
                label="Settings & privacy"
                accessibilityHint="Choose what Kinwise may notice, and see who has looked at your information"
                onSelect={onOpenSettings}
              />
            </DefaultFocus>
          </SpatialNavigationView>
          <Text style={type.small}>Arrows to move · OK to choose</Text>
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flexShrink: 1,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: s(4),
    marginBottom: s(20),
  },
  date: {
    marginLeft: s(36),
    color: colors.muted,
  },
  cards: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  card: {
    flex: 1,
    marginRight: s(28),
    overflow: 'hidden',
  },
  cardLast: {
    marginRight: 0,
  },
  item: {
    marginBottom: s(18),
  },
  reminderTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkedTag: {
    marginLeft: s(14),
    paddingHorizontal: s(12),
    borderRadius: s(10),
    borderWidth: s(2),
    borderColor: 'rgba(251, 191, 36, 0.6)',
    backgroundColor: colors.cautionTint,
  },
  checkedText: {
    color: colors.caution,
  },
  messageOuter: {
    marginBottom: s(8),
    marginHorizontal: -s(10),
  },
  message: {
    borderRadius: s(20),
    paddingVertical: s(14),
    paddingHorizontal: s(20),
    backgroundColor: colors.surface2,
    borderLeftWidth: s(8),
    borderLeftColor: colors.surface2,
  },
  messageUnread: {
    borderLeftColor: colors.cream,
    backgroundColor: '#24372a',
  },
  messageFocused: {
    backgroundColor: colors.cream,
  },
  messageTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  newTag: {
    paddingHorizontal: s(12),
    borderRadius: s(10),
    backgroundColor: colors.cream,
  },
  newTagText: {
    color: colors.onLight,
  },
  onLight: {
    color: colors.onLight,
  },
  onLightMuted: {
    color: '#3b4a3f',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: s(24),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionGap: {
    marginRight: s(20),
  },
});

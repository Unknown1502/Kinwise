import React, {useEffect, useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {isScreenReaderOn} from '../a11y/screenReader';
import {Avatar} from '../components/Avatar';
import {Focusable} from '../components/Focusable';
import {FocusButton} from '../components/FocusButton';
import {Icon, IconBadge} from '../components/Icon';
import {StatusChip} from '../components/StatusNote';
import {useLocalClock} from '../hooks/useLocalClock';
import {plural, statusPill} from '../logic/copy';
import {agenda, dayPart, minutesLeft, statusNote, type AgendaItem} from '../logic/today';
import {OnSurface} from '../theme/surface';
import {FOCUS, RADIUS, SAFE, colors, s, type} from '../theme/theme';
import type {TvStateView} from '../types';

export const MAX_HOME_MESSAGES = 2;
const MAX_AGENDA_ROWS = 3;

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

/**
 * The screen the TV shows most of the time: a warm family display. The clock and a greeting,
 * the latest note from family on apricot paper with the sender's face, and the day's visits and
 * reminders, each marked with its own colour and icon.
 */
export function HomeScreen({state, receivedAt, active, busyKey, onPrivacy, onOpenSettings, onReadMessage}: HomeScreenProps) {
  const {today} = state;
  const clock = useLocalClock({label: today.timeLabel, serverTime: state.serverTime, receivedAt});
  const pill = statusPill(state);
  const note = statusNote(state, minutesLeft(state.privacyHourUntil, state.serverTime, receivedAt, Date.now()));
  const hello = greeting(clock, today.residentName);
  const allItems = agenda(today, clock);
  const items = fitAgenda(allItems);
  const moreItems = allItems.length - items.length;
  const messages = today.messages.slice(0, MAX_HOME_MESSAGES);
  const hiddenMessages = today.messages.length - messages.length;
  const unread = today.messages.filter((m) => m.unread).length;
  const privacyOn = Boolean(today.privacyHourUntilLabel);
  const [clockNumber, clockSuffix] = splitClock(clock);

  const summary = useMemo(
    () =>
      [
        `${hello}. ${today.timeLabel}, ${today.dateLabel}.`,
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
      <View style={styles.screen} testID="home-screen">
        <View style={styles.top}>
          <View accessible accessibilityRole="header" accessibilityLabel={`${clock}. ${hello}. ${today.dateLabel}.`}>
            <Text style={type.clock}>
              {clockNumber}
              {clockSuffix ? <Text style={styles.suffix}>{` ${clockSuffix}`}</Text> : null}
            </Text>
            <Text style={[type.greeting, styles.greeting]}>{hello}</Text>
            <Text style={[type.lead, styles.date]}>{today.dateLabel}</Text>
          </View>
          <StatusChip note={note} />
        </View>

        <SpatialNavigationView direction="horizontal" style={styles.columns}>
          <OnSurface surface="apricot">
            <View style={styles.family}>
              {/* Always-present node so focus order stays stable as messages arrive. */}
              <DefaultFocus enable={messages.length > 0}>
                <SpatialNavigationView direction="vertical" style={styles.fill}>
                  {messages.length === 0 ? (
                    <View style={styles.familyEmpty}>
                      <Icon name="message-circle-heart" tone="dark" size={s(72)} />
                      <Text style={[type.lead, styles.onApricot, styles.familyEmptyText]}>
                        {`Notes from ${state.caregiver.name} will appear here.`}
                      </Text>
                    </View>
                  ) : null}
                  {messages.map((m, index) => {
                    const first = index === 0;
                    return (
                      <Focusable
                        key={index}
                        accessibilityRole="button"
                        accessibilityLabel={`${m.unread ? 'New message' : 'Message'} from ${m.from}, ${m.timeLabel}: ${m.text}`}
                        accessibilityHint={m.unread ? 'Select to mark it as read' : undefined}
                        busy={busyKey === `msg:${m.id}`}
                        onSelect={() => (m.unread ? onReadMessage(m.id) : announce(`${m.from} said: ${m.text}`))}
                        style={first ? styles.messageOuter : styles.messageOuterSmall}
                        radius={RADIUS.card}
                        grow={1.02}>
                        {() => (
                          first ? (
                            <View style={styles.message}>
                              <View style={styles.from}>
                                <Avatar name={m.from} size={s(88)} />
                                <View style={styles.fromText}>
                                  <Text style={[type.heading, styles.onApricot]}>{m.from}</Text>
                                  <Text style={[type.small, styles.onApricotSoft]}>{m.timeLabel}</Text>
                                </View>
                                {m.unread ? <NewBadge /> : null}
                              </View>
                              <Text style={[type.message, styles.onApricot, styles.messageText]} numberOfLines={3}>
                                {`“${m.text}”`}
                              </Text>
                            </View>
                          ) : (
                            <View style={[styles.message, styles.messageSmall]}>
                              <Avatar name={m.from} size={s(60)} />
                              <View style={styles.fromText}>
                                <Text style={[type.smallStrong, styles.onApricotSoft]}>{`${m.from}, ${m.timeLabel}`}</Text>
                                <Text style={[type.body, styles.onApricot]} numberOfLines={2}>
                                  {m.text}
                                </Text>
                              </View>
                              {m.unread ? <NewBadge /> : null}
                            </View>
                          )
                        )}
                      </Focusable>
                    );
                  })}
                  {hiddenMessages > 0 ? (
                    <Text style={[type.small, styles.onApricotSoft, styles.older]}>{plural(hiddenMessages, 'older note', 'older notes')}</Text>
                  ) : null}
                </SpatialNavigationView>
              </DefaultFocus>
            </View>
          </OnSurface>

          <View
            style={styles.today}
            accessible
            accessibilityRole="text"
            accessibilityLabel={
              items.length
                ? `Today: ${items.map((i) => `${i.time}, ${i.title}${i.flagged ? ', Kinwise checked this one' : ''}`).join('; ')}`
                : 'Nothing planned today'
            }>
            <View style={styles.todayHead}>
              <Icon name="calendar-days" size={s(40)} />
              <Text style={[type.heading, styles.todayTitle]}>Today</Text>
            </View>
            {items.length === 0 ? <Text style={[type.body, styles.soft]}>Nothing planned today.</Text> : null}
            {items.map((item) => (
              <AgendaRow key={item.id} item={item} />
            ))}
            {moreItems > 0 ? <Text style={type.small}>{`${plural(moreItems, 'more thing', 'more things')} today`}</Text> : null}
          </View>
        </SpatialNavigationView>

        <View style={styles.footer}>
          <SpatialNavigationView direction="horizontal" style={styles.actions}>
            <FocusButton
              icon="moon"
              label={privacyOn ? 'End privacy time' : 'Privacy time for an hour'}
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
                icon="settings"
                label="Settings & privacy"
                accessibilityHint="Choose what Kinwise may notice, and see who has looked at your information"
                onSelect={onOpenSettings}
              />
            </DefaultFocus>
          </SpatialNavigationView>
          <View style={styles.hint}>
            <Text style={type.small}>Press</Text>
            <View style={styles.okKey}>
              <Text style={[type.smallStrong, styles.okText]}>OK</Text>
            </View>
            <Text style={type.small}>to choose</Text>
          </View>
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

const MARK = {
  visit: {icon: 'door-open', color: colors.mint},
  reminder: {icon: 'bell', color: colors.sun},
  flagged: {icon: 'shield-alert', color: colors.coral},
} as const;

function AgendaRow({item}: {item: AgendaItem}) {
  const mark = item.flagged ? MARK.flagged : MARK[item.kind];
  const label =
    item.kind === 'visit' ? (item.when === 'now' ? 'Expected now' : 'Expected visitor') : item.flagged ? 'Kinwise checked this one' : 'Reminder';
  const labelColor = item.flagged ? colors.coral : item.when === 'now' ? colors.mint : colors.soft;
  return (
    <View style={[styles.row, item.when === 'past' ? styles.past : null]}>
      <IconBadge name={mark.icon} color={mark.color} size={s(60)} style={styles.badge} />
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text style={[type.smallStrong, styles.rowTime]}>{item.time}</Text>
          <Text style={[type.small, {color: labelColor}]}>{label}</Text>
        </View>
        <Text style={type.bodyStrong} numberOfLines={2}>
          {capitalize(item.title)}
        </Text>
      </View>
    </View>
  );
}

function NewBadge() {
  return (
    <View style={styles.newBadge}>
      <Text style={[type.smallStrong, styles.newText]}>New</Text>
    </View>
  );
}

/** "Good afternoon, Asha", from the household clock. In the small hours it is just "Hello". */
function greeting(clockLabel: string, name: string): string {
  const part = dayPart(clockLabel);
  const hello = part === 'morning' ? 'Good morning' : part === 'afternoon' ? 'Good afternoon' : part === 'evening' ? 'Good evening' : 'Hello';
  return `${hello}, ${name}`;
}

/** Reminders arrive as spoken ("courier from the bank…"); start them with a capital on screen. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Keep the list to what fits: when there's too much, the hours already gone go first. */
function fitAgenda(items: AgendaItem[]): AgendaItem[] {
  if (items.length <= MAX_AGENDA_ROWS) return items;
  const upcoming = items.filter((i) => i.when !== 'past');
  return (upcoming.length ? upcoming : items).slice(0, MAX_AGENDA_ROWS);
}

/** "2:19 PM" → ["2:19", "PM"]: the suffix is set smaller beside the numerals. */
function splitClock(label: string): [string, string] {
  const m = /^(\S+)\s+([AP]M)$/i.exec(label.trim());
  return m ? [m[1]!, m[2]!] : [label, ''];
}

const RING = FOCUS.width + FOCUS.gap;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  suffix: {
    fontSize: s(52),
    letterSpacing: 0,
  },
  greeting: {
    marginTop: -s(22),
  },
  date: {
    color: colors.soft,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    marginTop: s(36),
    marginBottom: s(30),
  },
  family: {
    flex: 1.45,
    backgroundColor: colors.apricot,
    borderRadius: RADIUS.panel,
    paddingVertical: s(30),
    paddingHorizontal: s(30),
    marginRight: s(36),
  },
  fill: {
    flex: 1,
  },
  familyEmpty: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: s(14),
  },
  familyEmptyText: {
    marginTop: s(18),
  },
  messageOuter: {
    marginHorizontal: -RING,
  },
  messageOuterSmall: {
    marginHorizontal: -RING,
    marginTop: s(10),
  },
  message: {
    borderRadius: RADIUS.card,
    paddingVertical: s(12),
    paddingHorizontal: s(14),
  },
  messageSmall: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  from: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fromText: {
    flex: 1,
    marginLeft: s(20),
  },
  newBadge: {
    backgroundColor: colors.sun,
    borderRadius: RADIUS.chip,
    paddingHorizontal: s(18),
    paddingVertical: s(4),
  },
  newText: {
    color: colors.deep,
  },
  messageText: {
    marginTop: s(16),
  },
  onApricot: {
    color: colors.onApricot,
  },
  onApricotSoft: {
    color: colors.onApricotSoft,
  },
  older: {
    marginTop: s(8),
    marginLeft: s(14),
  },
  today: {
    flex: 1,
    backgroundColor: colors.glass,
    borderColor: colors.glassLine,
    borderWidth: s(2),
    borderRadius: RADIUS.panel,
    paddingVertical: s(30),
    paddingHorizontal: s(36),
  },
  todayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(20),
  },
  todayTitle: {
    marginLeft: s(16),
  },
  soft: {
    color: colors.soft,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: s(22),
  },
  past: {
    opacity: 0.45,
  },
  badge: {
    marginRight: s(22),
    marginTop: s(4),
  },
  rowText: {
    flex: 1,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  rowTime: {
    marginRight: s(16),
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: -RING,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionGap: {
    marginRight: s(16),
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  okKey: {
    width: s(64),
    height: s(64),
    borderRadius: s(32),
    borderWidth: s(3),
    borderColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: s(14),
  },
  okText: {
    color: colors.white,
  },
});

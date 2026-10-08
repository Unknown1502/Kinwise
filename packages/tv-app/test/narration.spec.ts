/* What the TV says aloud (jest on the Vega build machine, vitest in packages/tv-preview). */
import {alertLine, callingLine, narration} from '../src/logic/narration';
import {SIGNS, expectedAlert, gentleAlert, homeState, pauseAlert, withAlert} from './fixtures';

describe('narration', () => {
  it('stays quiet on the first state unless an alert is on screen', () => {
    expect(narration(undefined, homeState())).toEqual([]);
    expect(narration(undefined, withAlert(homeState(), pauseAlert()))).toEqual([
      'Asha, someone is at your door, and no visit is expected right now. Please pause before you open it. Press OK to call Priya.',
    ]);
  });

  it('announces a new alert once', () => {
    const before = homeState();
    const after = withAlert(before, gentleAlert());
    expect(narration(before, after)).toEqual(["Someone is at the door. They're not on today's list, and you don't have to answer."]);
    expect(narration(after, after)).toEqual([]);
  });

  it('reads new family messages, oldest first', () => {
    const before = homeState();
    const m = (id: string, text: string) => ({id, from: 'Priya', text, timeLabel: '2:30 PM', unread: true});
    const after = homeState({today: {...before.today, messages: [m('n2', 'Second'), m('n1', 'First'), ...before.today.messages]}});
    expect(narration(before, after)).toEqual(['New message from Priya: First', 'New message from Priya: Second']);
  });

  it('says when privacy time starts and ends', () => {
    const off = homeState();
    const on = homeState({today: {...off.today, privacyHourUntilLabel: '3:19 PM'}});
    expect(narration(off, on)).toEqual(["Privacy time is on until 3:19 PM. Kinwise won't notice the door until then."]);
    expect(narration(on, off)).toEqual(['Privacy time has ended. Kinwise is noticing the door again.']);
  });

  it('says when the safety watch starts', () => {
    const calm = homeState();
    const watching = homeState({today: {...calm.today, safety: {level: 'high', untilLabel: '8:18 PM', signs: SIGNS}}});
    expect(narration(calm, watching)).toEqual([
      "Kinwise is watching the door more closely until 8:18 PM, because of today's warning signs.",
    ]);
  });

  it('reads what Alexa sent to the TV, once per cue', () => {
    const before = homeState();
    const after = homeState({cue: {id: 'cue_1', topic: 'messages', text: 'You have one message.'}});
    expect(narration(before, after)).toEqual(['You have one message.']);
    expect(narration(after, {...after})).toEqual([]);
  });

  it('words each kind of visitor and the call plainly', () => {
    expect(alertLine(expectedAlert(), 'Asha')).toBe("Luis (gardener) is at the door. They're on today's list.");
    expect(callingLine('Priya')).toBe("Calling Priya now. You don't need to open the door.");
  });
});

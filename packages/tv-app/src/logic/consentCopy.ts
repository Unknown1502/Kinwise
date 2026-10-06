import type {ConsentKey} from '../types';

export interface ConsentItem {
  key: ConsentKey;
  title: string;
  /** One plain line. */
  explanation: string;
}

/** The four switches the resident owns (spec §7, rule 1), in plain language. */
export function consentItems(caregiverName: string): ConsentItem[] {
  return [
    {
      key: 'scamScreening',
      title: 'Check for scam warning signs',
      explanation: 'Looks at reminders and “is this call real?” questions. What callers said is never kept.',
    },
    {
      key: 'doorAwareness',
      title: 'Notice visitors at my door',
      explanation: 'Uses the Ring doorbell to notice someone is there. Never faces, never recordings.',
    },
    {
      key: 'caregiverAlerts',
      title: `Alert ${caregiverName} if I might be at risk`,
      explanation: `If the Pause appears, ${caregiverName} gets a short alert so they can call you.`,
    },
    {
      key: 'shareTimelineWithCaregiver',
      title: `Let ${caregiverName} see my day's timeline`,
      explanation: 'Events only, like “visitor at 2:41 PM”. Never what was said or seen.',
    },
  ];
}

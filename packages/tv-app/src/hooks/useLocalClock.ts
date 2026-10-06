import {useEffect, useState} from 'react';
import {currentClockLabel, msUntilNextMinute, type ClockBase} from '../logic/clock';

/**
 * The household clock for the Home screen: the hub's label, advanced locally each minute
 * so it keeps ticking even if the hub is briefly unreachable.
 */
export function useLocalClock(base: ClockBase): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setTick((n) => n + 1);
        schedule();
      }, msUntilNextMinute(base, Date.now()) + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [base.label, base.serverTime, base.receivedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return currentClockLabel(base, Date.now());
}

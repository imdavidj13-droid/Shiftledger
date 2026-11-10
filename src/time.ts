import { Temporal } from '@js-temporal/polyfill';

export function branchInstant(input: string, zone: string, repeatedTime: 'earlier' | 'later' = 'earlier') {
  const local = Temporal.PlainDateTime.from(input);
  const selected = local.toZonedDateTime(zone, { disambiguation: repeatedTime });
  if (!selected.toPlainDateTime().equals(local)) {
    throw new Error('This time does not exist in ' + zone + ' because the clocks change. Choose another time.');
  }
  return selected.toInstant().toString({ smallestUnit: 'millisecond' });
}

export function isRepeatedTime(input: string, zone: string) {
  if (!input || !zone) return false;
  try {
    const local = Temporal.PlainDateTime.from(input);
    const earlier = local.toZonedDateTime(zone, { disambiguation: 'earlier' });
    const later = local.toZonedDateTime(zone, { disambiguation: 'later' });
    return earlier.toPlainDateTime().equals(local) &&
      later.toPlainDateTime().equals(local) &&
      !earlier.equals(later);
  } catch { return false; }
}

export function formatShiftTime(instant: string, zone: string, format: '12h' | '24h') {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hourCycle: format === '12h' ? 'h12' : 'h23',
    timeZoneName: 'short'
  }).format(new Date(instant));
}

export function branchWallTime(instant: string, zone: string) {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: 'millisecond' });
}

export function rotaWeek(requestedDate: string | null, zone: string, firstDay: number) {
  const today = Temporal.Now.plainDateISO(zone);
  let requested = today;
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    try { requested = Temporal.PlainDate.from(requestedDate); } catch { /* Use the current week. */ }
  }
  const first = requested.subtract({ days: (requested.dayOfWeek % 7 - firstDay + 7) % 7 });
  return {
    start: first.toString(),
    previous: first.subtract({ days: 7 }).toString(),
    next: first.add({ days: 7 }).toString(),
    days: Array.from({ length: 7 }, (_, index) => {
      const date = first.add({ days: index });
      const boundary = (day: typeof date) => day.toZonedDateTime(zone).toInstant().toString({ smallestUnit: 'millisecond' });
      return { label: date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
        date: date.toString(), from: boundary(date), to: boundary(date.add({ days: 1 })) };
    })
  };
}

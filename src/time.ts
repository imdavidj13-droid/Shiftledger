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

export function formatShiftClock(instant: string, zone: string, format: '12h' | '24h') {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone, hour: 'numeric', minute: '2-digit', hourCycle: format === '12h' ? 'h12' : 'h23'
  }).format(new Date(instant));
}

function rotaDate(requestedDate: string | null, zone: string) {
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    try { return Temporal.PlainDate.from(requestedDate); } catch { /* Use today. */ }
  }
  return Temporal.Now.plainDateISO(zone);
}

function dateBoundary(date: Temporal.PlainDate, zone: string) {
  return date.toZonedDateTime(zone).toInstant().toString({ smallestUnit: 'millisecond' });
}

function calendarDay(date: Temporal.PlainDate, zone: string) {
  return {
    label: date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    date: date.toString(), number: date.day, from: dateBoundary(date, zone),
    to: dateBoundary(date.add({ days: 1 }), zone)
  };
}

const weekOffset = (date: Temporal.PlainDate, firstDay: number) => (date.dayOfWeek % 7 - firstDay + 7) % 7;

export function rotaWeek(requestedDate: string | null, zone: string, firstDay: number) {
  const requested = rotaDate(requestedDate, zone);
  const first = requested.subtract({ days: weekOffset(requested, firstDay) });
  return {
    start: first.toString(),
    previous: first.subtract({ days: 7 }).toString(),
    next: first.add({ days: 7 }).toString(),
    days: Array.from({ length: 7 }, (_, index) => calendarDay(first.add({ days: index }), zone))
  };
}

export function rotaDay(requestedDate: string | null, zone: string) {
  const day = rotaDate(requestedDate, zone);
  return {
    previous: day.subtract({ days: 1 }).toString(),
    next: day.add({ days: 1 }).toString(),
    ...calendarDay(day, zone)
  };
}

export function rotaMonth(requestedMonth: string | null, zone: string, firstDay: number) {
  const requested = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth + '-01' : null;
  const first = rotaDate(requested, zone).with({ day: 1 });
  const leading = weekOffset(first, firstDay);
  const trailing = (7 - (leading + first.daysInMonth) % 7) % 7;
  const month = (date: Temporal.PlainDate) => date.toString().slice(0, 7);
  return {
    month: month(first),
    label: first.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    previous: month(first.subtract({ months: 1 })),
    next: month(first.add({ months: 1 })),
    today: rotaDate(null, zone).toString(),
    leading, trailing,
    weekdays: Array.from({ length: 7 }, (_, index) =>
      first.add({ days: index - leading }).toLocaleString(undefined, { weekday: 'short' })),
    days: Array.from({ length: first.daysInMonth }, (_, index) => calendarDay(first.add({ days: index }), zone))
  };
}

export function moveWallTime(input: string, days: number) {
  return Temporal.PlainDateTime.from(input).add({ days }).toString({ smallestUnit: 'millisecond' });
}

export function shiftOccurrence(instant: string, zone: string): 'earlier' | 'later' {
  const local = branchWallTime(instant, zone);
  return isRepeatedTime(local, zone) && branchInstant(local, zone) !== instant ? 'later' : 'earlier';
}

export function moveShiftTime(instant: string, zone: string, days: number) {
  return branchInstant(moveWallTime(branchWallTime(instant, zone), days), zone, shiftOccurrence(instant, zone));
}

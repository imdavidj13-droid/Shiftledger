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
  const local = Temporal.PlainDateTime.from(input);
  const earlier = local.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const later = local.toZonedDateTime(zone, { disambiguation: 'later' });
  return earlier.toPlainDateTime().equals(local) &&
    later.toPlainDateTime().equals(local) &&
    !earlier.equals(later);
}

export function formatShiftTime(instant: string, zone: string, format: '12h' | '24h') {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hourCycle: format === '12h' ? 'h12' : 'h23',
    timeZoneName: 'short'
  }).format(new Date(instant));
}

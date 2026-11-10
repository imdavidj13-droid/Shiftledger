import { expect, test } from '@playwright/test';
import { branchInstant, isRepeatedTime } from '../src/time';

test('local shift time resolves in the branch zone independently of the browser', () => {
  expect(branchInstant('2026-11-10T09:00', 'America/New_York')).toBe('2026-11-10T14:00:00.000Z');
  expect(branchInstant('2026-11-10T09:00', 'Asia/Kolkata')).toBe('2026-11-10T03:30:00.000Z');
});

test('spring-forward gaps are refused and both fall-back occurrences are selectable', () => {
  expect(() => branchInstant('2026-03-29T01:30', 'Europe/London')).toThrow('does not exist');
  expect(isRepeatedTime('2026-03-29T01:30', 'Europe/London')).toBe(false);
  expect(isRepeatedTime('2026-10-25T01:30', 'Europe/London')).toBe(true);
  expect(branchInstant('2026-10-25T01:30', 'Europe/London', 'earlier')).toBe('2026-10-25T00:30:00.000Z');
  expect(branchInstant('2026-10-25T01:30', 'Europe/London', 'later')).toBe('2026-10-25T01:30:00.000Z');
});

test('rota weeks use configured first day and include shorter and longer DST days', async () => {
  const { rotaWeek } = await import('../src/time');
  const spring = rotaWeek('2026-03-29', 'Europe/London', 1);
  expect(spring.start).toBe('2026-03-23');
  expect(Date.parse(spring.days[6].to) - Date.parse(spring.days[6].from)).toBe(23 * 3600000);
  const fall = rotaWeek('2026-10-25', 'Europe/London', 0);
  expect(fall.start).toBe('2026-10-25');
  expect(Date.parse(fall.days[0].to) - Date.parse(fall.days[0].from)).toBe(25 * 3600000);
});

test('calendar month uses the configured first day and local DST boundaries', async () => {
  const { rotaMonth } = await import('../src/time');
  const march = rotaMonth('2026-03', 'Europe/London', 1);
  expect(march.leading).toBe(6);
  expect(march.days).toHaveLength(31);
  expect(march.leading + march.days.length + march.trailing).toBe(42);
  expect(march.previous).toBe('2026-02');
  const transition = march.days[28];
  expect(Date.parse(transition.to) - Date.parse(transition.from)).toBe(23 * 3600000);
});

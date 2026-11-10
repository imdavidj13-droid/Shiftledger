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

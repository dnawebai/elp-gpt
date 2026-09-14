import assert from 'node:assert/strict';
import test from 'node:test';

import { elpTimeGreeting, greetingPeriodForHour } from '../lib/time-greeting.ts';

test('ELP greeting periods follow the local clock', () => {
  assert.equal(greetingPeriodForHour(4), 'evening');
  assert.equal(greetingPeriodForHour(5), 'morning');
  assert.equal(greetingPeriodForHour(11), 'morning');
  assert.equal(greetingPeriodForHour(12), 'afternoon');
  assert.equal(greetingPeriodForHour(17), 'afternoon');
  assert.equal(greetingPeriodForHour(18), 'evening');
  assert.equal(greetingPeriodForHour(23), 'evening');
});

test('ELP voice greeting addresses Sir with the correct time of day', () => {
  assert.equal(elpTimeGreeting(new Date(2026, 8, 13, 8, 0, 0)), 'Good morning, Sir. ELP is online.');
  assert.equal(elpTimeGreeting(new Date(2026, 8, 13, 14, 0, 0)), 'Good afternoon, Sir. ELP is online.');
  assert.equal(elpTimeGreeting(new Date(2026, 8, 13, 22, 0, 0)), 'Good evening, Sir. ELP is online.');
});

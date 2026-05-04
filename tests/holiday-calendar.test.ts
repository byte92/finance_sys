import assert from 'node:assert/strict'
import test from 'node:test'
import { parseChinaHolidayApiResponse } from '@/lib/external/holidayCalendar'

test('parseChinaHolidayApiResponse keeps adjusted holiday dates only', () => {
  const holidays = parseChinaHolidayApiResponse({
    '2026-05-01': { isOffDay: true, date: '2026-05-01' },
    '2026-05-04': { isOffDay: true, date: '2026-05-04' },
    '2026-05-05': { isOffDay: true, date: '2026-05-05' },
    '2026-05-09': { isOffDay: false, date: '2026-05-09' },
    broken: { isOffDay: true, date: 'bad-date' },
  })

  assert.deepEqual(holidays, ['2026-05-01', '2026-05-04', '2026-05-05'])
})

test('parseChinaHolidayApiResponse rejects invalid payloads', () => {
  assert.throws(() => parseChinaHolidayApiResponse(null), /Invalid China holiday/)
  assert.throws(() => parseChinaHolidayApiResponse([]), /Invalid China holiday/)
})

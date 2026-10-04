// Swedish calendar for parking rules: public holidays (allmänna helgdagar, lag 1989:253) and the
// three day types used on Swedish parking signs:
//   'vardag'   = weekday that is not the day before a Sunday/holiday   (black numbers)
//   'fore'     = day before a Sunday or public holiday, usually Saturday (numbers in brackets)
//   'helgdag'  = Sunday or public holiday                               (red numbers)
// Eves (midsommarafton, julafton, nyårsafton, påskafton) are not public holidays by law; each is the day
// before one, so it is 'fore'. Open question to confirm with the city: some sources treat them as holidays.
// All dates are local Stockholm calendar dates given as {y, m, d} (m = 1..12).

const pad = (n) => String(n).padStart(2, '0');
export const key = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;

// Date arithmetic on calendar dates via UTC (no time zone surprises).
export const toUTC = ({ y, m, d }) => Date.UTC(y, m - 1, d);
export const fromUTC = (t) => { const x = new Date(t); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
export const addDays = (date, n) => fromUTC(toUTC(date) + n * 86400000);
// ISO weekday: 1 = Monday … 7 = Sunday
export const isoWeekday = (date) => ((new Date(toUTC(date)).getUTCDay() + 6) % 7) + 1;

// Easter Sunday (Anonymous Gregorian algorithm)
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y, m: month, d: day };
}

// First date in [from, from+6] with the given ISO weekday
const firstWeekdayFrom = (from, wd) => { for (let i = 0; i < 7; i++) { const x = addDays(from, i); if (isoWeekday(x) === wd) return x; } };

const cache = new Map();
export function publicHolidays(y) {
  if (cache.has(y)) return cache.get(y);
  const e = easter(y);
  const list = {
    [key({ y, m: 1, d: 1 })]: 'Nyårsdagen',
    [key({ y, m: 1, d: 6 })]: 'Trettondedag jul',
    [key(addDays(e, -2))]: 'Långfredagen',
    [key(e)]: 'Påskdagen',
    [key(addDays(e, 1))]: 'Annandag påsk',
    [key({ y, m: 5, d: 1 })]: 'Första maj',
    [key(addDays(e, 39))]: 'Kristi himmelsfärdsdag',
    [key({ y, m: 6, d: 6 })]: 'Sveriges nationaldag',
    [key(addDays(e, 49))]: 'Pingstdagen',
    [key(firstWeekdayFrom({ y, m: 6, d: 20 }, 6))]: 'Midsommardagen',
    [key(firstWeekdayFrom({ y, m: 10, d: 31 }, 6))]: 'Alla helgons dag',
    [key({ y, m: 12, d: 25 })]: 'Juldagen',
    [key({ y, m: 12, d: 26 })]: 'Annandag jul',
  };
  cache.set(y, list);
  return list;
}

export const isHoliday = (date) => isoWeekday(date) === 7 || key(date) in publicHolidays(date.y);

export function dayType(date) {
  if (isHoliday(date)) return 'helgdag';
  if (isHoliday(addDays(date, 1))) return 'fore';
  return 'vardag';
}

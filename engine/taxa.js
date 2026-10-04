// Stockholm fee zones (taxa), encoded from the 11 PARKING_RATE texts in the city's open data (Oct 2026).
// Each zone: paid periods per day type (minutes from midnight), price in kr per hour, and residents' prices.
// dayType: 'vardag' | 'fore' | 'helgdag' (see holidays.js). A period with end 1440 runs to midnight.
const H = (h) => h * 60;
const all = ['vardag', 'fore', 'helgdag'];

export const TAXA = {
  1: { periods: [{ days: all, start: 0, end: H(24), price: 55 }], residents: null },
  2: { periods: [
        { days: ['vardag'], start: H(7), end: H(21), price: 31 },
        { days: ['fore', 'helgdag'], start: H(9), end: H(19), price: 31 },
      ], otherTime: 20, residents: { month: 1100, day: 75 } },
  3: { periods: [{ days: ['vardag'], start: H(7), end: H(19), price: 20 }, { days: ['fore'], start: H(11), end: H(17), price: 15 }], residents: { month: 1100, day: 75 } },
  4: { periods: [{ days: ['vardag'], start: H(7), end: H(19), price: 10 }, { days: ['fore'], start: H(11), end: H(17), price: 10 }], residents: { month: 500, day: 35 } },
  5: { periods: [{ days: ['vardag'], start: H(7), end: H(19), price: 5 }], residents: { month: 300, day: 20 } },
  11: { periods: [{ days: all, start: 0, end: H(24), price: 13.75 }], residents: null },
  12: { periods: [{ days: ['vardag'], start: H(7), end: H(21), price: 7.75 }, { days: ['fore', 'helgdag'], start: H(9), end: H(19), price: 7.75 }], otherTime: 5, residents: null },
  13: { periods: [{ days: ['vardag'], start: H(7), end: H(19), price: 5 }, { days: ['fore'], start: H(11), end: H(17), price: 3.75 }], residents: null },
  14: { periods: [{ days: ['vardag'], start: H(7), end: H(19), price: 2.5 }, { days: ['fore'], start: H(11), end: H(17), price: 2.5 }], residents: null },
  15: { periods: [{ days: ['vardag'], start: H(7), end: H(19), price: 2.5 }], residents: null },
};

// 'taxa 3: …' -> 3; 'avgiftsfri' -> 0; unknown -> null
export function taxaOf(rateText) {
  if (!rateText) return null;
  if (/^avgiftsfri/i.test(rateText.trim())) return 0;
  const m = /taxa\s*(\d+)/i.exec(rateText);
  return m && TAXA[m[1]] ? Number(m[1]) : null;
}

// Price per hour at a given day type and minute of day (0 = free right now, null = unknown zone)
export function pricePerHour(taxa, dayType, minute) {
  if (taxa === 0) return 0;
  const z = TAXA[taxa];
  if (!z) return null;
  const p = z.periods.find((p) => p.days.includes(dayType) && minute >= p.start && minute < p.end);
  if (p) return p.price;
  return z.otherTime ?? 0;
}

// Minutes of the day where the price may change, for building timelines
export function priceBoundaries(taxa) {
  const z = TAXA[taxa];
  if (!z) return [];
  return [...new Set(z.periods.flatMap((p) => [p.start, p.end]))].filter((m) => m > 0 && m < 1440);
}

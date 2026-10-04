// SWEREF 99 18 00 (EPSG:3011, Stockholm's local grid) → WGS84 lon/lat.
// Lantmäteriet's Gauss–Krüger inverse formulas for GRS80; accurate to well under a centimetre.
const a = 6378137.0, f = 1 / 298.257222101;
const lon0 = 18.0, k0 = 1.0, FN = 0.0, FE = 150000.0;
const e2 = f * (2 - f), n = f / (2 - f), aRoof = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
const d1 = n / 2 - 2 * n * n / 3 + 37 * n ** 3 / 96 - n ** 4 / 360;
const d2 = n * n / 48 + n ** 3 / 15 - 437 * n ** 4 / 1440;
const d3 = 17 * n ** 3 / 480 - 37 * n ** 4 / 840;
const d4 = 4397 * n ** 4 / 161280;
// Inverse (conformal -> geodetic latitude) coefficients.
const As = e2 + e2 ** 2 + e2 ** 3 + e2 ** 4, Bs = -(7 * e2 ** 2 + 17 * e2 ** 3 + 30 * e2 ** 4) / 6, Cs = (224 * e2 ** 3 + 889 * e2 ** 4) / 120, Ds = -(4279 * e2 ** 4) / 1260;
const rad = Math.PI / 180;

export function toWGS84(x /* easting */, y /* northing */) {
  const xi = (y - FN) / (k0 * aRoof), eta = (x - FE) / (k0 * aRoof);
  const xiP = xi - d1 * Math.sin(2 * xi) * Math.cosh(2 * eta) - d2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
    - d3 * Math.sin(6 * xi) * Math.cosh(6 * eta) - d4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
  const etaP = eta - d1 * Math.cos(2 * xi) * Math.sinh(2 * eta) - d2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
    - d3 * Math.cos(6 * xi) * Math.sinh(6 * eta) - d4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
  const phiStar = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  const dLon = Math.atan(Math.sinh(etaP) / Math.cos(xiP));
  const s = Math.sin(phiStar) ** 2;
  const phi = phiStar + Math.sin(phiStar) * Math.cos(phiStar) * (As + Bs * s + Cs * s * s + Ds * s ** 3);
  return [lon0 + dLon / rad, phi / rad];
}

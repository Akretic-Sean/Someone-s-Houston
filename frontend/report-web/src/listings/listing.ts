/**
 * Shape of the maxcopell/zillow-scraper dataset, taken from a real run rather
 * than guessed. Every field is still treated as possibly absent — it is not a
 * contract we control — and a missing value stays missing. Nothing is invented
 * to fill a card.
 */
export interface Listing {
  key: string;
  zpid: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  price: number | null;
  priceLabel: string | null;
  beds: number | null;
  baths: number | null;
  area: number | null;
  areaUnit: string | null;
  homeType: string | null;
  status: string | null;
  daysOnZillow: number | null;
  imageUrl: string | null;
  detailUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

type Row = Record<string, unknown>;

function obj(value: unknown): Row {
  return typeof value === 'object' && value !== null ? (value as Row) : {};
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** "forSale" / "SINGLE_FAMILY" are not for reading. */
export function humanise(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

export function normalise(raw: unknown, index: number): Listing {
  const row = obj(raw);
  const price = obj(row.listingPrice);
  const address = obj(row.listingAddress);
  const coords = obj(row.coordinates);
  const zpid = str(row.zpid);
  const url = str(row.propertyUrl);

  const firstPhoto = Array.isArray(row.listingPhotos)
    ? str(obj(row.listingPhotos[0]).url)
    : null;

  return {
    key: zpid ?? url ?? `row-${index}`,
    zpid,
    address: str(address.full) ?? str(address.street),
    city: str(address.city),
    zipCode: str(address.zipCode),
    price: num(price.amount),
    priceLabel: str(price.formatted),
    beds: num(row.bedrooms),
    baths: num(row.bathrooms),
    area: num(row.livingArea),
    areaUnit: str(row.livingAreaUnit) ?? 'sqft',
    homeType: humanise(str(row.homeType)),
    status: humanise(str(row.listingStatus)),
    daysOnZillow: num(row.daysOnZillow),
    imageUrl: str(row.mainImage) ?? firstPhoto,
    detailUrl: url,
    latitude: num(coords.latitude),
    longitude: num(coords.longitude),
  };
}

export function formatUsd(value: number | null): string | null {
  return value === null ? null : `$${Math.round(value).toLocaleString('en-US')}`;
}

/** Houston, roughly. Only used to warn when a run scraped somewhere else. */
const HOUSTON = { south: 29.4, north: 30.2, west: -95.9, east: -94.9 };

export function outsideHouston(listing: Listing): boolean {
  const { latitude: lat, longitude: lon } = listing;
  if (lat === null || lon === null) return false;
  return lat < HOUSTON.south || lat > HOUSTON.north || lon < HOUSTON.west || lon > HOUSTON.east;
}

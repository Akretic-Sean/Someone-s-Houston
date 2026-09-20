/**
 * Demo listing snapshot for the neighborhood report.
 *
 * Captured once from Zillow via the Apify actor maxcopell/zillow-scraper on
 * 2026-09-19, bounded to Greater Eastwood's published centroid.
 * This is a FIXTURE, not a live feed: prices and availability are frozen at the
 * capture date and the UI says so. Nothing here refreshes.
 *
 * Zillow's terms restrict automated scraping, so this stays a prototype
 * snapshot; a licensed IDX/MLS feed is the production path.
 */

export interface DemoListing {
  zpid: string | null;
  address: string | null;
  zipCode: string | null;
  priceLabel: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  area: number | null;
  homeType: string | null;
  daysOnZillow: number | null;
  imageUrl: string | null;
  detailUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export const DEMO_LISTINGS_CAPTURED_AT = '2026-09-19';
export const DEMO_LISTINGS_SOURCE = 'Zillow via Apify (maxcopell/zillow-scraper)';

/** Keyed by the City's Super Neighborhood id. 64 = Greater Eastwood. */
export const DEMO_LISTINGS: Record<number, DemoListing[]> = {
  64: [
    {
        "zpid": "27753085",
        "address": "5709 Sherman St, Houston, TX 77011",
        "zipCode": "77011",
        "priceLabel": "$199,900",
        "price": 199900,
        "beds": 4,
        "baths": 2,
        "area": 1338,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 0,
        "imageUrl": "https://photos.zillowstatic.com/fp/fb971380bb5a6149122edf8e7c25b9da-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/5709-Sherman-St-Houston-TX-77011/27753085_zpid/",
        "latitude": 29.742908,
        "longitude": -95.31706
    },
    {
        "zpid": "458913644",
        "address": "126 Sidney St, Houston, TX 77003",
        "zipCode": "77003",
        "priceLabel": "$509,900",
        "price": 509900,
        "beds": 3,
        "baths": 4,
        "area": 2248,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 0,
        "imageUrl": "https://photos.zillowstatic.com/fp/d9e673c52bb2df4b835b5730cf05acee-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/126-Sidney-St-Houston-TX-77003/458913644_zpid/",
        "latitude": 29.747559,
        "longitude": -95.33221
    },
    {
        "zpid": "27821187",
        "address": "1564 Godwin St, Houston, TX 77023",
        "zipCode": "77023",
        "priceLabel": "$600,000",
        "price": 600000,
        "beds": 3,
        "baths": 3,
        "area": 3874,
        "homeType": "MULTI_FAMILY",
        "daysOnZillow": 1,
        "imageUrl": "https://photos.zillowstatic.com/fp/d4f98b6102c3135b3cdcbd1f1479c510-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/1564-Godwin-St-Houston-TX-77023/27821187_zpid/",
        "latitude": 29.725655,
        "longitude": -95.32695
    },
    {
        "zpid": "448168572",
        "address": "5302 S Capitol, Houston, TX 77023",
        "zipCode": "77023",
        "priceLabel": "$650,000",
        "price": 650000,
        "beds": 4,
        "baths": 5,
        "area": 2966,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 1,
        "imageUrl": "https://photos.zillowstatic.com/fp/3f562f4c13257989c3d2274ad048dd40-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/5302-S-Capitol-Houston-TX-77023/448168572_zpid/",
        "latitude": 29.74006,
        "longitude": -95.32384
    },
    {
        "zpid": "449871707",
        "address": "612 Delmar, Houston, TX 77023",
        "zipCode": "77023",
        "priceLabel": "$485,000",
        "price": 485000,
        "beds": 3,
        "baths": 4,
        "area": 2264,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 1,
        "imageUrl": "https://photos.zillowstatic.com/fp/a679e731f8dc6a9a7d02d2e7a97562ad-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/612-Delmar-Houston-TX-77023/449871707_zpid/",
        "latitude": 29.73978,
        "longitude": -95.32359
    },
    {
        "zpid": "243981484",
        "address": "1614 Sampson St, Houston, TX 77003",
        "zipCode": "77003",
        "priceLabel": "$499,999",
        "price": 499999,
        "beds": 3,
        "baths": 4,
        "area": 2519,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 1,
        "imageUrl": "https://photos.zillowstatic.com/fp/d537e8cde0179839a7906dc7e81ceb6d-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/1614-Sampson-St-Houston-TX-77003/243981484_zpid/",
        "latitude": 29.7397,
        "longitude": -95.3485
    },
    {
        "zpid": "465357466",
        "address": "3418 Dennis St, Houston, TX 77004",
        "zipCode": "77004",
        "priceLabel": "$195,000",
        "price": 195000,
        "beds": null,
        "baths": 0,
        "area": null,
        "homeType": "LOT",
        "daysOnZillow": 2,
        "imageUrl": "https://photos.zillowstatic.com/fp/543b017dba8e7e77e02073533d85e53d-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/3418-Dennis-St-Houston-TX-77004/465357466_zpid/",
        "latitude": 29.732533,
        "longitude": -95.35112
    },
    {
        "zpid": "161436228",
        "address": "3309 Jefferson St #C, Houston, TX 77003",
        "zipCode": "77003",
        "priceLabel": "$385,000",
        "price": 385000,
        "beds": 3,
        "baths": 4,
        "area": 2139,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 2,
        "imageUrl": "https://photos.zillowstatic.com/fp/b314efb6d89c3921a78224594e231f33-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/3309-Jefferson-St-C-Houston-TX-77003/161436228_zpid/",
        "latitude": 29.739637,
        "longitude": -95.349434
    },
    {
        "zpid": "27771548",
        "address": "212 Super St, Houston, TX 77011",
        "zipCode": "77011",
        "priceLabel": "$249,900",
        "price": 249900,
        "beds": 3,
        "baths": 2,
        "area": 2028,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 2,
        "imageUrl": "https://photos.zillowstatic.com/fp/cd6faa44e39723ffd1decfce5be3fb84-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/212-Super-St-Houston-TX-77011/27771548_zpid/",
        "latitude": 29.746122,
        "longitude": -95.33004
    },
    {
        "zpid": "84033811",
        "address": "2215 Nettleton St, Houston, TX 77004",
        "zipCode": "77004",
        "priceLabel": "$299,000",
        "price": 299000,
        "beds": 3,
        "baths": 3,
        "area": 1517,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 2,
        "imageUrl": "https://maps.googleapis.com/maps/api/staticmap?mobile=false&sensor=true&maptype=satellite&size=575x242&zoom=17&center=29.737136840820312,-95.35327911376953&key=AIzaSyBWYJWCA8FNMQvSe_k3LKfDGJaEgdKwsco&signature=C080WcdoAFcBPYsU0R-220VWCRA=",
        "detailUrl": "https://www.zillow.com/homedetails/2215-Nettleton-St-Houston-TX-77004/84033811_zpid/",
        "latitude": 29.737137,
        "longitude": -95.35328
    },
    {
        "zpid": "27750669",
        "address": "4534 Woodside St, Houston, TX 77023",
        "zipCode": "77023",
        "priceLabel": "$719,999",
        "price": 719999,
        "beds": 5,
        "baths": 3,
        "area": 2792,
        "homeType": "SINGLE_FAMILY",
        "daysOnZillow": 2,
        "imageUrl": "https://photos.zillowstatic.com/fp/b8de1621e6e8053b36cddaa976ad3353-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/4534-Woodside-St-Houston-TX-77023/27750669_zpid/",
        "latitude": 29.738785,
        "longitude": -95.33246
    },
    {
        "zpid": "2122148553",
        "address": "2323 Polk St APT 306, Houston, TX 77003",
        "zipCode": "77003",
        "priceLabel": "$405,000",
        "price": 405000,
        "beds": 2,
        "baths": 2,
        "area": 1877,
        "homeType": "CONDO",
        "daysOnZillow": 2,
        "imageUrl": "https://photos.zillowstatic.com/fp/f108c118a6a488cab102d6d963df7a6d-p_e.jpg",
        "detailUrl": "https://www.zillow.com/homedetails/2323-Polk-St-APT-306-Houston-TX-77003/2122148553_zpid/",
        "latitude": 29.74803,
        "longitude": -95.35446
    }
],
};

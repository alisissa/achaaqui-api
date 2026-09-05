import type {
  OfferAvailability,
  Prisma,
  ReviewStatus,
} from '../src/generated/prisma/client';

export interface CategorySeed {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface BrandSeed {
  slug: string;
  name: string;
}

export interface MerchantSeed {
  slug: string;
  name: string;
  city: string;
  countryCode: string;
  address: string;
  phone: string;
  websiteUrl: string;
}

export interface ProductSeed {
  slug: string;
  name: string;
  description: string;
  model: string;
  barcode: string;
  categorySlug: string;
  brandSlug: string;
  featured: boolean;
  popularityScore: number;
  imageUrl: string;
}

export interface OfferSeed {
  merchantSlug: string;
  productSlug: string;
  merchantSku: string;
  price: Prisma.Decimal | string;
  currency: string;
  availability: OfferAvailability;
  stockQuantity: number | null;
  ageHours: number;
}

export interface ReviewSeed {
  id: string;
  merchantSlug: string;
  productSlug: string;
  productRating: number;
  merchantRating: number;
  reviewerDisplayName: string;
  title: string;
  comment: string;
  status: ReviewStatus;
  createdDaysAgo: number;
}

export const categories: CategorySeed[] = [
  {
    slug: 'phones',
    name: 'Phones',
    description: 'Smartphones and mobile essentials',
    sortOrder: 10,
  },
  {
    slug: 'computers',
    name: 'Computers',
    description: 'Laptops, storage, and computing gear',
    sortOrder: 20,
  },
  {
    slug: 'gaming',
    name: 'Gaming',
    description: 'Consoles and gaming accessories',
    sortOrder: 30,
  },
  {
    slug: 'audio',
    name: 'Audio',
    description: 'Headphones and speakers',
    sortOrder: 40,
  },
  {
    slug: 'home',
    name: 'Home',
    description: 'Useful technology for the home',
    sortOrder: 50,
  },
];

export const brands: BrandSeed[] = [
  { slug: 'apple', name: 'Apple' },
  { slug: 'samsung', name: 'Samsung' },
  { slug: 'sony', name: 'Sony' },
  { slug: 'lenovo', name: 'Lenovo' },
  { slug: 'sandisk', name: 'SanDisk' },
  { slug: 'jbl', name: 'JBL' },
  { slug: 'philips', name: 'Philips' },
];

export const merchants: MerchantSeed[] = [
  {
    slug: 'northstar-tech',
    name: 'Northstar Tech',
    city: 'Asunción',
    countryCode: 'PY',
    address: 'Av. Central 1840',
    phone: '+595 21 555 0101',
    websiteUrl: 'https://example.com/northstar',
  },
  {
    slug: 'pixel-market',
    name: 'Pixel Market',
    city: 'San Lorenzo',
    countryCode: 'PY',
    address: 'Ruta 2, km 14',
    phone: '+595 21 555 0102',
    websiteUrl: 'https://example.com/pixel-market',
  },
  {
    slug: 'casa-digital',
    name: 'Casa Digital',
    city: 'Luque',
    countryCode: 'PY',
    address: 'Los Jardines 320',
    phone: '+595 21 555 0103',
    websiteUrl: 'https://example.com/casa-digital',
  },
];

export const products: ProductSeed[] = [
  {
    slug: 'apple-iphone-16-128gb',
    name: 'Apple iPhone 16 128GB',
    description:
      'A compact flagship smartphone with a bright display, capable cameras, and all-day battery life.',
    model: 'iPhone 16 128GB',
    barcode: '0195949822015',
    categorySlug: 'phones',
    brandSlug: 'apple',
    featured: true,
    popularityScore: 98,
    imageUrl:
      'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'samsung-galaxy-s25-256gb',
    name: 'Samsung Galaxy S25 256GB',
    description:
      'A fast Android phone with a vivid display, versatile cameras, and generous storage.',
    model: 'SM-S931B',
    barcode: '0887276751018',
    categorySlug: 'phones',
    brandSlug: 'samsung',
    featured: true,
    popularityScore: 94,
    imageUrl:
      'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'lenovo-ideapad-slim-5-14',
    name: 'Lenovo IdeaPad Slim 5 14-inch',
    description:
      'A balanced everyday laptop with a compact aluminum design and a crisp 14-inch display.',
    model: 'IdeaPad Slim 5 14',
    barcode: '0197530014102',
    categorySlug: 'computers',
    brandSlug: 'lenovo',
    featured: true,
    popularityScore: 89,
    imageUrl:
      'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'sandisk-extreme-portable-ssd-1tb',
    name: 'SanDisk Extreme Portable SSD 1TB',
    description:
      'A pocket-sized solid-state drive for fast transfers and durable mobile storage.',
    model: 'SDSSDE61-1T00',
    barcode: '0619659182557',
    categorySlug: 'computers',
    brandSlug: 'sandisk',
    featured: false,
    popularityScore: 77,
    imageUrl:
      'https://images.unsplash.com/photo-1628557044797-f21a177c37ec?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'sony-playstation-5-slim',
    name: 'Sony PlayStation 5 Slim',
    description:
      'Current-generation console performance in a slimmer body with an included wireless controller.',
    model: 'CFI-2015',
    barcode: '0711719577416',
    categorySlug: 'gaming',
    brandSlug: 'sony',
    featured: true,
    popularityScore: 96,
    imageUrl:
      'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'sony-dualsense-wireless-controller',
    name: 'Sony DualSense Wireless Controller',
    description:
      'A responsive wireless controller with haptic feedback and adaptive triggers.',
    model: 'CFI-ZCT1W',
    barcode: '0711719541264',
    categorySlug: 'gaming',
    brandSlug: 'sony',
    featured: false,
    popularityScore: 82,
    imageUrl:
      'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'sony-wh-1000xm5',
    name: 'Sony WH-1000XM5 Headphones',
    description:
      'Comfortable over-ear headphones with adaptive noise cancellation and clear calls.',
    model: 'WH-1000XM5',
    barcode: '0027242923348',
    categorySlug: 'audio',
    brandSlug: 'sony',
    featured: true,
    popularityScore: 91,
    imageUrl:
      'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'jbl-flip-6',
    name: 'JBL Flip 6 Portable Speaker',
    description:
      'A rugged portable Bluetooth speaker with punchy sound and water-resistant construction.',
    model: 'JBLFLIP6',
    barcode: '0050036384636',
    categorySlug: 'audio',
    brandSlug: 'jbl',
    featured: false,
    popularityScore: 73,
    imageUrl:
      'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'apple-watch-series-10-42mm',
    name: 'Apple Watch Series 10 42mm',
    description:
      'A slim smartwatch for everyday activity, notifications, and health insights.',
    model: 'Series 10 42mm',
    barcode: '0195949959018',
    categorySlug: 'phones',
    brandSlug: 'apple',
    featured: false,
    popularityScore: 86,
    imageUrl:
      'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?auto=format&fit=crop&w=900&q=80',
  },
  {
    slug: 'philips-airfryer-xl-62l',
    name: 'Philips Airfryer XL 6.2L',
    description:
      'A family-sized air fryer with adjustable temperature and simple digital controls.',
    model: 'HD9270/91',
    barcode: '8710103975584',
    categorySlug: 'home',
    brandSlug: 'philips',
    featured: true,
    popularityScore: 79,
    imageUrl:
      'https://images.unsplash.com/photo-1648023504374-0c3c3e3c8d90?auto=format&fit=crop&w=900&q=80',
  },
];

export const offers: OfferSeed[] = [
  {
    merchantSlug: 'northstar-tech',
    productSlug: 'apple-iphone-16-128gb',
    merchantSku: 'NST-IP16-128',
    price: '829.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 8,
    ageHours: 1,
  },
  {
    merchantSlug: 'pixel-market',
    productSlug: 'apple-iphone-16-128gb',
    merchantSku: 'PM-IP16-BLK',
    price: '845.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 4,
    ageHours: 5,
  },
  {
    merchantSlug: 'casa-digital',
    productSlug: 'apple-iphone-16-128gb',
    merchantSku: 'CD-APPLE-16128',
    price: '819.00',
    currency: 'USD',
    availability: 'OUT_OF_STOCK',
    stockQuantity: 0,
    ageHours: 190,
  },
  {
    merchantSlug: 'northstar-tech',
    productSlug: 'samsung-galaxy-s25-256gb',
    merchantSku: 'NST-S25-256',
    price: '735.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 12,
    ageHours: 2,
  },
  {
    merchantSlug: 'pixel-market',
    productSlug: 'samsung-galaxy-s25-256gb',
    merchantSku: 'PM-GS25-256',
    price: '729.50',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 3,
    ageHours: 76,
  },
  {
    merchantSlug: 'northstar-tech',
    productSlug: 'lenovo-ideapad-slim-5-14',
    merchantSku: 'NST-LNV-SL5',
    price: '679.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 5,
    ageHours: 8,
  },
  {
    merchantSlug: 'casa-digital',
    productSlug: 'lenovo-ideapad-slim-5-14',
    merchantSku: 'CD-LEN-145',
    price: '655.00',
    currency: 'USD',
    availability: 'UNKNOWN',
    stockQuantity: null,
    ageHours: 180,
  },
  {
    merchantSlug: 'pixel-market',
    productSlug: 'sandisk-extreme-portable-ssd-1tb',
    merchantSku: 'PM-SD-EXT1T',
    price: '104.90',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 9,
    ageHours: 12,
  },
  {
    merchantSlug: 'casa-digital',
    productSlug: 'sandisk-extreme-portable-ssd-1tb',
    merchantSku: 'CD-SD1TB',
    price: '109.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 6,
    ageHours: 30,
  },
  {
    merchantSlug: 'northstar-tech',
    productSlug: 'sony-playstation-5-slim',
    merchantSku: 'NST-PS5-SLIM',
    price: '529.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 7,
    ageHours: 4,
  },
  {
    merchantSlug: 'pixel-market',
    productSlug: 'sony-playstation-5-slim',
    merchantSku: 'PM-PS5-2026',
    price: '519.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 2,
    ageHours: 27,
  },
  {
    merchantSlug: 'casa-digital',
    productSlug: 'sony-dualsense-wireless-controller',
    merchantSku: 'CD-DUAL-WHT',
    price: '72.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 18,
    ageHours: 48,
  },
  {
    merchantSlug: 'northstar-tech',
    productSlug: 'sony-wh-1000xm5',
    merchantSku: 'NST-XM5-BLK',
    price: '329.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 6,
    ageHours: 16,
  },
  {
    merchantSlug: 'pixel-market',
    productSlug: 'sony-wh-1000xm5',
    merchantSku: 'PM-XM5',
    price: '319.00',
    currency: 'USD',
    availability: 'OUT_OF_STOCK',
    stockQuantity: 0,
    ageHours: 200,
  },
  {
    merchantSlug: 'casa-digital',
    productSlug: 'jbl-flip-6',
    merchantSku: 'CD-JBL-F6',
    price: '99.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 11,
    ageHours: 20,
  },
  {
    merchantSlug: 'pixel-market',
    productSlug: 'apple-watch-series-10-42mm',
    merchantSku: 'PM-AWS10-42',
    price: '389.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 4,
    ageHours: 6,
  },
  {
    merchantSlug: 'northstar-tech',
    productSlug: 'apple-watch-series-10-42mm',
    merchantSku: 'NST-AW10-42',
    price: '399.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 7,
    ageHours: 55,
  },
  {
    merchantSlug: 'casa-digital',
    productSlug: 'philips-airfryer-xl-62l',
    merchantSku: 'CD-PH-AF62',
    price: '142.00',
    currency: 'USD',
    availability: 'IN_STOCK',
    stockQuantity: 9,
    ageHours: 10,
  },
  {
    merchantSlug: 'pixel-market',
    productSlug: 'philips-airfryer-xl-62l',
    merchantSku: 'PM-HD9270',
    price: '139.90',
    currency: 'USD',
    availability: 'UNKNOWN',
    stockQuantity: null,
    ageHours: 120,
  },
];

export const reviews: ReviewSeed[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    merchantSlug: 'northstar-tech',
    productSlug: 'apple-iphone-16-128gb',
    productRating: 5,
    merchantRating: 5,
    reviewerDisplayName: 'Marina',
    title: 'Exactly what I expected',
    comment:
      'The phone was sealed and the store answered my questions quickly.',
    status: 'PUBLISHED',
    createdDaysAgo: 18,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    merchantSlug: 'pixel-market',
    productSlug: 'apple-iphone-16-128gb',
    productRating: 4,
    merchantRating: 3,
    reviewerDisplayName: 'Lucas',
    title: 'Good product, slow collection',
    comment:
      'The device is excellent, although collection took longer than promised.',
    status: 'PUBLISHED',
    createdDaysAgo: 12,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    merchantSlug: 'casa-digital',
    productSlug: 'apple-iphone-16-128gb',
    productRating: 4,
    merchantRating: 2,
    reviewerDisplayName: 'Ana',
    title: 'Needs moderation',
    comment: 'The listing was still visible when the product was unavailable.',
    status: 'PENDING',
    createdDaysAgo: 2,
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    merchantSlug: 'northstar-tech',
    productSlug: 'samsung-galaxy-s25-256gb',
    productRating: 5,
    merchantRating: 4,
    reviewerDisplayName: 'Rafael',
    title: 'Fast and straightforward',
    comment: 'Accurate price and the device was ready when I arrived.',
    status: 'PUBLISHED',
    createdDaysAgo: 15,
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    merchantSlug: 'pixel-market',
    productSlug: 'samsung-galaxy-s25-256gb',
    productRating: 1,
    merchantRating: 1,
    reviewerDisplayName: 'Demo spam',
    title: 'Rejected example',
    comment: 'Promotional content that should not be published.',
    status: 'REJECTED',
    createdDaysAgo: 7,
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    merchantSlug: 'northstar-tech',
    productSlug: 'sony-playstation-5-slim',
    productRating: 5,
    merchantRating: 5,
    reviewerDisplayName: 'Bruno',
    title: 'Great console and service',
    comment: 'The current price matched the catalog and checkout was quick.',
    status: 'PUBLISHED',
    createdDaysAgo: 25,
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    merchantSlug: 'pixel-market',
    productSlug: 'sony-playstation-5-slim',
    productRating: 4,
    merchantRating: 3,
    reviewerDisplayName: 'Carla',
    title: 'Console is good',
    comment:
      'Everything works well. Communication from the store could improve.',
    status: 'PUBLISHED',
    createdDaysAgo: 9,
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    merchantSlug: 'casa-digital',
    productSlug: 'jbl-flip-6',
    productRating: 4,
    merchantRating: 4,
    reviewerDisplayName: 'Diego',
    title: 'Good portable speaker',
    comment: 'Sound is clear and the store information was accurate.',
    status: 'PUBLISHED',
    createdDaysAgo: 20,
  },
  {
    id: '10000000-0000-4000-8000-000000000009',
    merchantSlug: 'northstar-tech',
    productSlug: 'sony-wh-1000xm5',
    productRating: 5,
    merchantRating: 2,
    reviewerDisplayName: 'Fernanda',
    title: 'Product great, service unclear',
    comment:
      'The headphones are excellent but warranty information was confusing.',
    status: 'PENDING',
    createdDaysAgo: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000010',
    merchantSlug: 'pixel-market',
    productSlug: 'apple-watch-series-10-42mm',
    productRating: 5,
    merchantRating: 4,
    reviewerDisplayName: 'João',
    title: 'Useful everyday watch',
    comment: 'Good product and the advertised price was correct.',
    status: 'PUBLISHED',
    createdDaysAgo: 11,
  },
  {
    id: '10000000-0000-4000-8000-000000000011',
    merchantSlug: 'casa-digital',
    productSlug: 'philips-airfryer-xl-62l',
    productRating: 3,
    merchantRating: 3,
    reviewerDisplayName: 'Paula',
    title: 'Works as described',
    comment: 'A practical appliance and an average collection experience.',
    status: 'PUBLISHED',
    createdDaysAgo: 30,
  },
  {
    id: '10000000-0000-4000-8000-000000000012',
    merchantSlug: 'northstar-tech',
    productSlug: 'apple-watch-series-10-42mm',
    productRating: 5,
    merchantRating: 5,
    reviewerDisplayName: 'Mateus',
    title: 'Smooth purchase',
    comment: 'The store confirmed stock immediately and collection was easy.',
    status: 'PUBLISHED',
    createdDaysAgo: 6,
  },
];

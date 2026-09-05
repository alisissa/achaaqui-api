# Architecture decisions

Last updated: 2026-09-05

## Repository layout

There are three user-owned repositories:

- `achaaqui-api` contains the modular NestJS API and Prisma schema.
- `achaaqui-mobile` contains the Expo/React Native customer application.
- `achaaqui-admin` contains the Next.js operational portal supplied by the user on 2026-09-03.

No shared package has been introduced. The API OpenAPI document remains the contract boundary; generated clients can be considered when contract churn justifies them.

## Foundation defaults

- Node.js 22.22.3 LTS and npm are pinned for both repositories.
- NestJS 11 is pinned because the current throttling package has not declared NestJS 12 compatibility.
- PostgreSQL 16 is the local default and Compose binds it to host port 5433 to avoid common local port conflicts. Prisma owns schema changes through migrations.
- Prisma 7 is used rather than the Prisma 8 release candidate currently tagged as latest in the registry.
- Public REST routes are versioned under `/v1`. Current admin routes use a server-side API-key guard for the local/private-beta slice. This is temporary and must be replaced with user authentication and role/merchant claims before public deployment.
- Money is stored as PostgreSQL `numeric(14,2)` and serialized as decimal strings.
- Product images use URL/object-key records. Seed URLs are replaceable development imagery, not final assets.
- Search starts with exact normalized barcode matching plus case-insensitive PostgreSQL matching for names, models, brands, and merchant SKUs. Trigram/full-text and accent-folding indexes will only be added after query behavior is measured.
- Offer freshness thresholds are configuration, not product policy: `FRESHNESS_AGING_HOURS` defaults to 72 and `FRESHNESS_STALE_HOURS` to 168 for local development.
- Favorites store product identity and a fallback snapshot in device-local storage, then refresh current values from the API when the Saved screen opens. Failed refreshes are labelled as saved snapshots. There is no customer identity or synchronization in v1.
- Currency is display-only in the MVP. There is no conversion and no cross-currency price ranking. The API returns the lowest offer per currency and exposes a single `bestPrice` only when all active offers share one currency.
- The mobile query layer is TanStack Query; local favorite state uses React context. No general-purpose state framework is introduced.

## Visual system extracted from the references

The five reference screenshots use a prominent app bar, immediate search access, image-led cards, horizontal browsing sections, compact comparison rows, strong price hierarchy, discovery chips, and persistent bottom navigation. The implementation translates those patterns into an original system:

- deep forest navigation with leaf-green accents, warm neutral surfaces, and a restrained coral highlight;
- off-white background, white elevated surfaces, 16–20 px corner radii, and 8 px spacing increments;
- dark navy titles, high-contrast prices, quieter metadata, and explicit availability/freshness pills;
- large product imagery with a consistent square crop and responsive two-column layouts on phones;
- bottom tabs for home, categories, and local favorites, with search as a focused stack route.

## Reviews and search reporting

- A customer review belongs to a merchant offer (`MerchantProduct`) and records separate 1–5 product and merchant scores. Published scores only are exposed publicly.
- A merchant product card shows a simple buying score only when both the global product and merchant have published ratings. The score is hidden when either side has no reputation instead of lending a new merchant the product's rating.
- Customer review submission is not exposed yet. Seeded reviews exercise moderation without opening an anonymous spam surface.
- Every explicitly submitted mobile search records one `SearchEvent`. Every unique merchant/product pair returned on that page records one `SearchMerchantHit`, enabling per-merchant search exposure without counting debounced prefixes as separate searches.
- The mobile client supplies an anonymous installation token, platform, and app version. The API HMAC-hashes the token and request IP; raw identifiers and raw IP addresses are not stored. Request logs exclude query strings. Search events default to 90-day retention; cleanup is an explicit protected operation intended for Cloud Scheduler rather than application startup.
- `countryCode` is reserved but remains empty until a trusted proxy or explicit location source is selected. Precise location is not inferred.
- First-party PostgreSQL reporting is authoritative. Mixpanel or another product analytics tool can be added later for funnels, but is not required for this reporting slice.

No source logos, advertisements, icons, merchant artwork, or screen compositions are copied.

## Open product decisions

These remain intentionally reversible and do not block local work:

- final product/company name, logo, palette, market, and primary language;
- whether currency conversion is ever required; the MVP deliberately groups display-only prices by currency;
- final category taxonomy;
- iOS and Android bundle identifiers;
- admin/merchant authentication provider and merchant onboarding policy;
- production PostgreSQL provider, GCP project, and region;
- production freshness thresholds;
- matching policy when no exact identifier exists.
- search analytics retention and production privacy-notice language;
- Firebase Authentication claim design for platform administrators and merchant users;
- whether merchant onboarding is invitation-only or starts with a request form.

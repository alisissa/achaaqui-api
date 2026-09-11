import { Prisma } from '../generated/prisma/client';

// Imports and individual edits must acquire the same locks, including new offers.
export async function lockMerchantOffers(
  transaction: Prisma.TransactionClient,
  merchantId: string,
  productIds: readonly string[],
): Promise<void> {
  const keys = [...new Set(productIds)]
    .map((id) => `${merchantId}:${id}`)
    .sort();
  if (!keys.length) return;
  await transaction.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(lock_key, 0))
    FROM unnest(ARRAY[${Prisma.join(keys)}]::text[]) AS lock_key
    ORDER BY lock_key
  `);
}

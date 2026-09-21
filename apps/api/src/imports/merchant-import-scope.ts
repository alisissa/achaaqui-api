import type { Prisma } from '../generated/prisma/client';

export type MerchantImportKind = 'photo' | 'file';

export function merchantImportScope(
  merchantId: string,
  kind: MerchantImportKind = 'photo',
): Pick<Prisma.ImportWhereInput, 'merchantId' | 'sourceType' | 'actorId'> {
  return {
    merchantId,
    sourceType: kind === 'photo' ? 'PHOTO' : { in: ['CSV', 'XLSX'] },
    // Admin-staged spreadsheets remain in the admin workflow.
    ...(kind === 'file' ? { actorId: { startsWith: 'merchant:' } } : {}),
  };
}

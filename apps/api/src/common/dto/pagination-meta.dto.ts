export class PaginationMetaDto {
  declare total: number;
  declare page: number;
  declare pageSize: number;
  declare totalPages: number;
}

export function paginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMetaDto {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

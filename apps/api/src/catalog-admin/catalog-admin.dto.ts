import {
  Equals,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class CatalogProductParam {
  @IsUUID() declare productId: string;
}

export class CatalogImageParam {
  @Matches(/^[a-f0-9]{64}\.webp$/) declare filename: string;
}

// Multipart fields remain strings. Never coerce arbitrary text to true.
export class UpdateCatalogPresentation {
  @IsISO8601() declare expectedUpdatedAt: string;
  @IsUUID() declare categoryId: string;
  @IsString() @Length(1, 240) declare altText: string;
  @Equals('true') declare confirmed: string;
}

export class CreateCatalogCategory {
  @IsString()
  @Length(1, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  declare slug: string;
  @IsString() @Length(2, 100) declare name: string;
  @Equals(true) declare confirmed: boolean;
}

export interface CatalogPresentation {
  id: string;
  name: string;
  categoryId: string;
  updatedAt: string;
  image: { url: string; altText: string | null } | null;
}

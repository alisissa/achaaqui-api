import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class CatalogProductParam {
  @IsUUID() declare productId: string;
}

export class CatalogGalleryImageParam {
  @IsUUID() declare productId: string;
  @IsUUID() declare imageId: string;
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

export const CATALOG_GALLERY_MAX_IMAGES = 8;

// Multipart fields remain strings, like the presentation form.
export class AddCatalogImage {
  @IsISO8601() declare expectedUpdatedAt: string;
  @IsString() @Length(1, 240) declare altText: string;
  @Equals('true') declare confirmed: string;
}

/** Visible image ids in their new order; the first becomes the main photo. */
export class ReorderCatalogImages {
  @IsISO8601() declare expectedUpdatedAt: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CATALOG_GALLERY_MAX_IMAGES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  declare imageIds: string[];
  @Equals(true) declare confirmed: boolean;
}

export class DeleteCatalogImage {
  @IsISO8601() declare expectedUpdatedAt: string;
  @Equals(true) declare confirmed: boolean;
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

export interface CatalogGallery {
  productId: string;
  updatedAt: string;
  images: {
    id: string;
    url: string;
    altText: string | null;
    sortOrder: number;
  }[];
}

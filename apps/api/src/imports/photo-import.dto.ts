import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CommitImportDto } from './imports.dto';

// All fields are editable raw strings. Domain validation belongs to the shared
// importer so invalid prices/barcodes return row-level guidance, not lost rows.
export class PhotoRowInputDto {
  @IsString() @MaxLength(500) merchantSku = '';
  @IsString() @MaxLength(500) productName = '';
  @IsString() @MaxLength(500) brand = '';
  @IsString() @MaxLength(500) model = '';
  @IsString() @MaxLength(500) barcode = '';
  @IsString() @MaxLength(500) price = '';
  @IsString() @MaxLength(500) currency = '';
  @IsString() @MaxLength(500) stock = '';
  @IsString() @MaxLength(500) availability = '';
  @IsString() @MaxLength(500) category = '';
}
export class PhotoPreviewVersionDto {
  @Matches(/^[a-f0-9]{64}$/) declare expectedPreviewToken: string;
}
export class ResolvePhotoRowDto extends PhotoPreviewVersionDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => PhotoRowInputDto)
  declare input: PhotoRowInputDto;
  @IsBoolean() declare skip: boolean;
}
export class CommitPhotoImportDto extends CommitImportDto {
  @Matches(/^[a-f0-9]{64}$/) declare expectedPreviewToken: string;
  @Equals(true) declare confirmed: boolean;
  @Equals(true) declare reviewedPhoto: boolean;
}

import {
  Equals,
  IsBoolean,
  IsISO8601,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
export class CommercialChangeDto {
  @IsISO8601({ strict: true }) declare expectedUpdatedAt: string;
  @Equals(true) declare confirmed: boolean;
  @ValidateIf((_o, value: unknown) => value !== null)
  @IsString()
  @MaxLength(32)
  declare salePrice: string | null;
  @ValidateIf((_o, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  declare saleEndsAt: string | null;
  @ValidateIf((_o, value: unknown) => value !== null)
  @IsString()
  @MaxLength(500)
  declare promotionText: string | null;
  @ValidateIf((_o, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  declare promotionEndsAt: string | null;
}
export class HighlightChangeDto {
  @IsISO8601({ strict: true }) declare expectedUpdatedAt: string;
  @IsBoolean() declare sponsored: boolean;
}

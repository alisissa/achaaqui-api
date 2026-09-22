import { Transform } from 'class-transformer';
import {
  Equals,
  IsISO8601,
  IsBoolean,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class MerchantLoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{2,39}$/)
  declare username: string;

  @IsString()
  @Length(1, 128)
  declare password: string;
}

export class SetMerchantLoginDto extends MerchantLoginDto {
  @IsString()
  @Length(15, 128, { message: 'Use uma senha de 15 a 128 caracteres.' })
  declare password: string;
}

export class MerchantLoginStatusDto {
  @IsBoolean()
  declare active: boolean;
}

export class DeleteMerchantLoginDto {
  @IsUUID()
  declare expectedUserId: string;

  @IsISO8601({ strict: true })
  declare expectedUpdatedAt: string;

  // Opaque identifier for the privately recorded, verified request; no email/text.
  @IsUUID()
  declare requestId: string;

  @Equals(true)
  declare ownershipVerified: true;

  @Equals(true)
  declare confirmed: true;
}

export class OwnOfferParamDto {
  @IsUUID()
  declare offerId: string;
}

export interface MerchantSessionDto {
  username: string;
  merchant: { id: string; name: string };
  expiresAt: string;
}

export interface MerchantLoginResponseDto extends MerchantSessionDto {
  token: string;
}

export interface MerchantLoginConfigurationDto {
  login: {
    id: string;
    username: string;
    active: boolean;
    updatedAt: string;
  } | null;
}

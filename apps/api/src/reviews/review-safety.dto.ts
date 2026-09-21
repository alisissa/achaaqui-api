import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsUUID,
  IsBoolean,
  Equals,
  ValidateIf,
} from 'class-validator';

export class ReportReviewDto {
  @IsIn(['SPAM', 'ABUSE', 'OTHER'])
  declare reason: 'SPAM' | 'ABUSE' | 'OTHER';
}

export class ResolveReportsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  declare reportIds: string[];
}

export class ReviewSafetyResultDto {
  declare saved: boolean;
}

export class EmptyReviewSafetyDto {}

export class SetReviewerAccessDto {
  @IsBoolean()
  declare banned: boolean;

  @Equals(true)
  declare confirmed: true;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  declare expectedRevision: string | null;
}

import { IsString, Matches, MaxLength } from 'class-validator';

export class SlugParamDto {
  @IsString()
  @MaxLength(180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  declare slug: string;
}

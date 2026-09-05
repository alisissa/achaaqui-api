import { IsUUID } from 'class-validator';

export class IdParamDto {
  @IsUUID()
  declare id: string;
}

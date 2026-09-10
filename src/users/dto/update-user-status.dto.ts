import { IsEnum } from 'class-validator';

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}

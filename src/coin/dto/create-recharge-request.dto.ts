import {
  IsInt,
  IsPositive,
  IsUUID,
} from 'class-validator';

export class CreateRechargeRequestDto {
  @IsUUID()
  targetUserId!: string;

  @IsInt()
  @IsPositive()
  amount!: number;
}

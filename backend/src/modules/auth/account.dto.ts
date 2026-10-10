import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
export class PreferencesDto {
  @IsInt() @Min(0) @Max(2147483646) revision!: number;
  @IsIn(["blue", "light", "graphite"]) theme!: string;
  @IsIn(["initials", "emoji", "photo"]) avatar_kind!: string;
  @IsIn(["🙂", "😎", "🌿", "⚡"]) emoji!: string;
  @IsString() @MaxLength(82000) photo!: string;
  @IsString() @Matches(/^$|^\d{8}$/) cep!: string;
  @IsString() @Matches(/^$|^\+?[0-9 ()-]{8,25}$/) personal_phone!: string;
}
export class FactorDto {
  @IsUUID() factor_id!: string;
}
export class VerifyFactorDto extends FactorDto {
  @IsUUID() challenge_id!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}

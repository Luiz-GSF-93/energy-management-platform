import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateContractDto } from './create-contract.dto';

export class UpdateContractDto extends PartialType(
  OmitType(CreateContractDto, ['contractNumber'] as const),
) {}

import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';

const writeValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
});

/** Validate at the service boundary, including calls that do not pass through HTTP. */
export async function validateWriteDto<T extends object>(
  metatype: Type<T>,
  value: T,
): Promise<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Request body must be an object');
  }
  if (Object.keys(value).length === 0) {
    throw new BadRequestException('At least one field is required');
  }
  return writeValidation.transform(value, { type: 'body', metatype });
}

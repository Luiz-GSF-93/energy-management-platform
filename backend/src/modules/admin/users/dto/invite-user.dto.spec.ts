import { validate } from 'class-validator';
import { InviteUserDto } from './invite-user.dto';

describe('InviteUserDto — F1.2.4c.1', () => {
  const validInput: InviteUserDto = {
    email: 'user@example.test',
    name: 'Example User',
    roleId: '11111111-1111-4111-8111-111111111111',
    affiliationType: 'internal',
  };

  const makeDto = (
    overrides: Partial<InviteUserDto> = {},
  ): InviteUserDto =>
    Object.assign(new InviteUserDto(), validInput, overrides);

  it('accepts the minimum valid invite contract', async () => {
    const errors = await validate(makeDto());

    expect(errors).toHaveLength(0);
  });

  it('rejects malformed email', async () => {
    const errors = await validate(
      makeDto({ email: 'not-an-email' }),
    );

    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });

  it('rejects empty name', async () => {
    const errors = await validate(
      makeDto({ name: '' }),
    );

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('rejects malformed roleId', async () => {
    const errors = await validate(
      makeDto({ roleId: 'not-a-uuid' }),
    );

    expect(errors.some((error) => error.property === 'roleId')).toBe(true);
  });

  it('accepts internal affiliation', async () => {
    const errors = await validate(
      makeDto({ affiliationType: 'internal' }),
    );

    expect(errors).toHaveLength(0);
  });

  it('accepts external affiliation', async () => {
    const errors = await validate(
      makeDto({ affiliationType: 'external' }),
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects unsupported affiliation', async () => {
    const errors = await validate(
      makeDto({
        affiliationType: 'partner' as any,
      }),
    );

    expect(
      errors.some(
        (error) => error.property === 'affiliationType',
      ),
    ).toBe(true);
  });

  it('does not expose organizationId in the DTO contract', () => {
    const dto = new InviteUserDto();

    expect('organizationId' in dto).toBe(false);
  });
});

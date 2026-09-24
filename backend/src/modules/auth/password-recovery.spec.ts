import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PasswordRecoveryService } from './password-recovery.service';
import { ForgotPasswordDto, ResetPasswordDto } from './password-recovery.controller';

describe('Password recovery', () => {
  let service: PasswordRecoveryService;
  let auth: any;
  let supabase: any;
  beforeEach(() => {
    auth = {
      resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
      verifyOtp: jest.fn().mockResolvedValue({ data: { session: { access_token: 'private' }, user: { id: 'proved-user' } }, error: null }),
      updateUser: jest.fn().mockResolvedValue({ error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    };
    supabase = { createAuthClient: jest.fn(() => ({ auth })) };
    service = new PasswordRecoveryService(supabase, { get: () => 'https://app.expertenergy.com.br' } as any);
  });
  it('uses a fixed redirect and identical replies for unknown accounts/provider errors', async () => {
    const known = await service.request('test@example.com', 'ip');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('test@example.com', { redirectTo: 'https://app.expertenergy.com.br/auth/reset-password' });
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'account not found' } });
    expect(await service.request('unknown@example.com', 'ip')).toEqual(known);
    auth.resetPasswordForEmail.mockRejectedValueOnce(new Error('provider detail'));
    expect(await service.request('unknown@example.com', 'ip')).toEqual(known);
  });
  it('requires recovery proof and never returns a session', async () => {
    expect(await service.complete('a'.repeat(64), 'test-password-only', 'ip')).toEqual({ success: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'a'.repeat(64), type: 'recovery' });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'test-password-only' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });
  it('rejects invalid or replayed tokens without changing any user', async () => {
    auth.verifyOtp.mockResolvedValue({ data: null, error: { message: 'expired' } });
    await expect(service.complete('a'.repeat(64), 'test-password-only', 'ip')).rejects.toThrow(BadRequestException);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it('fails closed when verification has no session', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: 'x' } }, error: null });
    await expect(service.complete('a'.repeat(64), 'test-password-only', 'ip')).rejects.toThrow(BadRequestException);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('cleans up a verified session if password policy rejects the change', async () => {
    auth.updateUser.mockResolvedValue({ error: { message: 'same password' } });
    await expect(service.complete('a'.repeat(64), 'test-password-only', 'ip')).rejects.toThrow('Não foi possível alterar');
    expect(auth.signOut).toHaveBeenCalled();
  });
  it('does not report password failure after a successful update if logout fails', async () => {
    auth.signOut.mockRejectedValue(new Error('network'));
    expect(await service.complete('a'.repeat(64), 'test-password-only', 'ip')).toEqual({ success: true });
  });
  it('limits requests independently of the supplied email', async () => {
    for (let i = 0; i < 5; i++) await service.request('user' + i + '@example.com', 'same-ip');
    await expect(service.request('other@example.com', 'same-ip')).rejects.toMatchObject({ status: 429 });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(5);
    await expect(service.request('other@example.com', 'different-ip')).resolves.toBeDefined();
  });
  it('limits failed token attempts and releases the window after one minute', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    auth.verifyOtp.mockResolvedValue({ data: null, error: {} });
    try {
      for (let i = 0; i < 10; i++) await service.complete('a'.repeat(64), 'test-password-only', 'ip').catch(() => {});
      await expect(service.complete('a'.repeat(64), 'test-password-only', 'ip')).rejects.toMatchObject({ status: 429 });
      now.mockReturnValue(62_000);
      await expect(service.complete('a'.repeat(64), 'test-password-only', 'ip')).rejects.toMatchObject({ status: 400 });
    } finally { now.mockRestore(); }
  });
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it('normalizes email and rejects caller-controlled redirects', async () => {
    const dto = await pipe.transform({ email: ' TEST@example.com ' }, { type: 'body', metatype: ForgotPasswordDto });
    expect(dto.email).toBe('test@example.com');
    await expect(pipe.transform({ email: 'test@example.com', redirectTo: 'https://evil.example' }, { type: 'body', metatype: ForgotPasswordDto })).rejects.toThrow();
  });
  it.each([
    { token_hash: 'jwt.token', password: 'test-password-only' },
    { token_hash: 'a'.repeat(64), password: 'short' },
    { token_hash: 'a'.repeat(64), password: 'a'.repeat(129) },
    { token_hash: 'a'.repeat(64), password: 'test-password-only', userId: 'victim' },
  ])('rejects invalid reset input %#', async input => {
    await expect(pipe.transform(input, { type: 'body', metatype: ResetPasswordDto })).rejects.toThrow();
  });
});

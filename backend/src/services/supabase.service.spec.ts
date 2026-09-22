import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('SupabaseService configuration', () => {
  const mockedCreateClient = createClient as jest.MockedFunction<
    typeof createClient
  >;

  const config = (
    values: Record<string, string | undefined>,
  ): ConfigService =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateClient.mockReturnValue({} as any);
  });

  it('fails closed when SUPABASE_URL is missing', () => {
    const configService = config({
      SUPABASE_SERVICE_KEY: 'test-service-key',
    });

    expect(
      () => new SupabaseService(configService),
    ).toThrow('Supabase configuration unavailable');

    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it('fails closed when SUPABASE_SERVICE_KEY is missing', () => {
    const configService = config({
      SUPABASE_URL: 'https://example.invalid',
    });

    expect(
      () => new SupabaseService(configService),
    ).toThrow('Supabase configuration unavailable');

    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it('creates the primary client when configuration is complete', () => {
    const configService = config({
      SUPABASE_URL: 'https://example.invalid',
      SUPABASE_SERVICE_KEY: 'test-service-key',
    });

    new SupabaseService(configService);

    expect(mockedCreateClient).toHaveBeenCalledTimes(1);
    expect(mockedCreateClient).toHaveBeenCalledWith(
      'https://example.invalid',
      'test-service-key',
    );
  });

  it('createAuthClient remains fail-closed when configuration becomes unavailable', () => {
    const values: Record<string, string | undefined> = {
      SUPABASE_URL: 'https://example.invalid',
      SUPABASE_SERVICE_KEY: 'test-service-key',
    };

    const service = new SupabaseService(config(values));

    values.SUPABASE_SERVICE_KEY = undefined;
    mockedCreateClient.mockClear();

    expect(
      () => service.createAuthClient(),
    ).toThrow('Supabase configuration unavailable');

    expect(mockedCreateClient).not.toHaveBeenCalled();
  });
});

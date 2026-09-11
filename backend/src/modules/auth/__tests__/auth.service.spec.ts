import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('test_token'),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test_secret'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('validateUser', () => {
    it('should validate admin user with correct password', async () => {
      const user = await service.validateUser(
        'admin@expertenergy.com.br',
        'Admin@2026!',
      );
      expect(user).toBeDefined();
      expect(user.email).toBe('admin@expertenergy.com.br');
      expect(user.role).toBe('ADMIN');
      expect(user.tenant_id).toBe('tenant_default');
    });

    it('should return null for invalid password', async () => {
      const user = await service.validateUser(
        'admin@expertenergy.com.br',
        'WrongPassword123!',
      );
      expect(user).toBeNull();
    });

    it('should return null for non-existent user', async () => {
      const user = await service.validateUser(
        'nonexistent@example.com',
        'Password123!',
      );
      expect(user).toBeNull();
    });

    it('should validate client user', async () => {
      const user = await service.validateUser(
        'teste@expertenergy.com.br',
        'ExpertEnergy@2026!',
      );
      expect(user).toBeDefined();
      expect(user.role).toBe('CLIENT');
    });
  });

  describe('login', () => {
    it('should return access_token and user for valid credentials', async () => {
      const result = await service.login(
        'admin@expertenergy.com.br',
        'Admin@2026!',
      );
      expect(result).toBeDefined();
      expect(result.access_token).toBe('test_token');
      expect(result.user).toBeDefined();
      expect(result.user.tenant_id).toBe('tenant_default');
    });

    it('should include tenant_id in JWT payload', async () => {
      const payload = {
        sub: '1',
        email: 'admin@expertenergy.com.br',
        role: 'ADMIN',
        tenant_id: 'tenant_default',
        tenant_name: 'Expert Energy',
      };
      service.generateToken(payload);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant_default',
        }),
      );
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      const payload = {
        sub: '1',
        email: 'admin@expertenergy.com.br',
        role: 'ADMIN',
      };
      const profile = await service.getProfile(payload);
      expect(profile).toBeDefined();
      expect(profile.email).toBe('admin@expertenergy.com.br');
    });
  });
});

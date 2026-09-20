import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth - Switch Organization E2E (Phase 5.5b.2)', () => {
  let app: INestApplication;
  let supabaseService: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    supabaseService = moduleFixture.get('SupabaseService');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Scenario 1: Invalid JWT', () => {
    it('GET /auth/my-organizations with invalid JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/my-organizations')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);

      expect(res.body.message).toContain('Invalid token');
    });

    it('POST /auth/switch-organization with invalid JWT → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/switch-organization/some-org-id')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);

      expect(res.body.message).toContain('Invalid token');
    });
  });

  describe('Scenario 2: Valid JWT + Normal Pointer', () => {
    let validToken: string;
    let userId: string;

    beforeAll(async () => {
      // Precisa de um usuário e JWT válidos
      // TODO: Criar fixture ou usar dados existentes
    });

    it('GET /auth/my-organizations → 200 with valid data', async () => {
      // TODO: Implementar teste com dados reais
    });
  });

  describe('Scenario 3-9: Outros cenários', () => {
    it('TODO: Implementar testes para os demais cenários', () => {
      // Aguardando dados existentes do banco
    });
  });
});

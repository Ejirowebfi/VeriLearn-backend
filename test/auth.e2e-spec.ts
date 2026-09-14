import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `e2e-${Date.now()}@test.com`,
          firstName: 'E2E',
          lastName: 'Test',
          password: 'Password123!',
        })
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toHaveProperty('email');
    });

    it('returns 409 on duplicate email', async () => {
      const email = `dup-${Date.now()}@test.com`;
      await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        email,
        firstName: 'A',
        lastName: 'B',
        password: 'Password123!',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          firstName: 'A',
          lastName: 'B',
          password: 'Password123!',
        })
        .expect(409);
    });

    it('returns 400 on invalid payload', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'short' })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    const email = `login-${Date.now()}@test.com`;

    beforeAll(async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        email,
        firstName: 'Login',
        lastName: 'User',
        password: 'Password123!',
      });
    });

    it('logs in with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('returns 401 with wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPass!' })
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('returns success message for existing email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'admin@verilearn.io' })
        .expect(200);

      expect(res.body.message).toContain('reset link');
    });

    it('returns same message for non-existing email (no enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody@nowhere.com' })
        .expect(200);

      expect(res.body.message).toContain('reset link');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('returns new tokens with valid refresh token', async () => {
      const email = `refresh-${Date.now()}@test.com`;
      const reg = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          firstName: 'R',
          lastName: 'T',
          password: 'Password123!',
        });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: reg.body.refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('returns 401 for invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(401);
    });
  });

  describe('GET /api/v1/users/me', () => {
    it('returns user profile with valid token', async () => {
      const email = `me-${Date.now()}@test.com`;
      const reg = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          firstName: 'Me',
          lastName: 'User',
          password: 'Password123!',
        });

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${reg.body.accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(email);
    });

    it('returns 401 without token', async () => {
      await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    });
  });
});

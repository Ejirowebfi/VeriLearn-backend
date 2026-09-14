import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Courses (e2e)', () => {
  let app: INestApplication;
  let instructorToken: string;
  let studentToken: string;
  let courseId: string;

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

    // Login as seeded instructor
    const instrRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'instructor@verilearn.io',
        password: 'Instructor@123456',
      });
    instructorToken = instrRes.body.accessToken;

    // Register a student
    const ts = Date.now();
    const stuRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `student-${ts}@test.com`,
        firstName: 'Stu',
        lastName: 'Dent',
        password: 'Password123!',
      });
    studentToken = stuRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/courses', () => {
    it('returns paginated published courses without auth', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses')
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('limit');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('supports page and limit params', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses?page=1&limit=5')
        .expect(200);

      expect(res.body.limit).toBe(5);
      expect(res.body.page).toBe(1);
    });
  });

  describe('POST /api/v1/courses', () => {
    it('creates a course as instructor', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/courses')
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({
          title: `E2E Course ${Date.now()}`,
          description: 'A test course created by e2e',
          level: 'beginner',
          price: 0,
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.status).toBe('draft');
      courseId = res.body.id;
    });

    it('returns 403 when student tries to create a course', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/courses')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ title: 'Forbidden', description: 'Should fail' })
        .expect(403);
    });

    it('returns 401 without token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/courses')
        .send({ title: 'No auth', description: 'Should fail' })
        .expect(401);
    });
  });

  describe('GET /api/v1/courses/:id', () => {
    it('returns course details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/courses/${courseId}`)
        .expect(200);

      expect(res.body.id).toBe(courseId);
    });

    it('returns 404 for unknown course', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/courses/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/courses/:id', () => {
    it('publishes a course as owner', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/courses/${courseId}`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ status: 'published' })
        .expect(200);

      expect(res.body.status).toBe('published');
    });

    it('returns 403 when non-owner tries to update', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/courses/${courseId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ title: 'Stolen' })
        .expect(403);
    });
  });

  describe('POST /api/v1/courses/:id/enroll', () => {
    it('enrolls student in published course', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/enroll`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.courseId).toBe(courseId);
    });

    it('returns 409 on duplicate enrollment', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/enroll`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(409);
    });
  });

  describe('GET /api/v1/courses/my/enrollments', () => {
    it('returns student enrollments', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses/my/enrollments')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((e: any) => e.courseId === courseId)).toBe(true);
    });
  });

  describe('POST /api/v1/courses/:id/complete', () => {
    it('marks enrollment as completed', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);

      expect(res.body.isCompleted).toBe(true);
    });
  });

  describe('GET /health', () => {
    it('returns health status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body).toHaveProperty('status');
    });
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api returns hello', async () => {
    await request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });
});

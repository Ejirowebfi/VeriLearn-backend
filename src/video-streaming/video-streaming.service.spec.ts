import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import { VideoStreamingService } from './video-streaming.service';

jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

const configValues: Record<string, any> = {
  VIDEO_STORAGE_PATH: './storage/videos',
  VIDEO_TOKEN_SECRET: 'test-secret',
};

const mockConfigService = {
  get: jest.fn((key: string, fallback?: any) => configValues[key] ?? fallback),
};

function mockResponse() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  } as any;
}

describe('VideoStreamingService', () => {
  let service: VideoStreamingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues.VIDEO_STORAGE_PATH = './storage/videos';
    configValues.VIDEO_TOKEN_SECRET = 'test-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoStreamingService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<VideoStreamingService>(VideoStreamingService);
  });

  describe('production secret enforcement', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('throws at construction time if VIDEO_TOKEN_SECRET is unset in production', () => {
      process.env.NODE_ENV = 'production';
      configValues.VIDEO_TOKEN_SECRET = undefined;
      expect(() => new VideoStreamingService(mockConfigService as any)).toThrow(
        /VIDEO_TOKEN_SECRET/,
      );
    });
  });

  describe('generateStreamToken / verifyStreamToken', () => {
    it('round-trips a valid token', () => {
      const token = service.generateStreamToken('lesson-1', 'user-1');
      const payload = service.verifyStreamToken(token);
      expect(payload.lessonId).toBe('lesson-1');
      expect(payload.userId).toBe('user-1');
    });

    it('rejects a tampered signature', () => {
      const token = service.generateStreamToken('lesson-1', 'user-1');
      const [data] = token.split('.');
      const tampered = `${data}.invalid-signature`;
      expect(() => service.verifyStreamToken(tampered)).toThrow(
        ForbiddenException,
      );
    });

    it('rejects an expired token', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const token = service.generateStreamToken('lesson-1', 'user-1');
      jest.setSystemTime(new Date('2026-01-01T02:00:00Z')); // past the 1h TTL
      expect(() => service.verifyStreamToken(token)).toThrow(
        ForbiddenException,
      );
      jest.useRealTimers();
    });
  });

  describe('lessonId/token binding (authorization)', () => {
    it('streamHls rejects a token issued for a different lesson', async () => {
      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamHls('lesson-B', token, mockResponse()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('streamSegment rejects a token issued for a different lesson', async () => {
      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamSegment('lesson-B', 'seg-1.ts', token, mockResponse()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('streamDash rejects a token issued for a different lesson', async () => {
      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamDash('lesson-B', token, mockResponse()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('streamRange (mp4) rejects a token issued for a different lesson', async () => {
      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamRange('lesson-B', token, '', mockResponse()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('streamSegment allows a token that matches the requested lesson', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ size: 1024 } as any);
      mockedFs.createReadStream.mockReturnValue({ pipe: jest.fn() } as any);

      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamSegment('lesson-A', 'seg-1.ts', token, mockResponse()),
      ).resolves.toBeUndefined();
    });
  });

  describe('path traversal protection', () => {
    it('rejects a segment containing directory traversal', async () => {
      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamSegment(
          'lesson-A',
          '../../etc/passwd',
          token,
          mockResponse(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedFs.existsSync).not.toHaveBeenCalled();
    });

    it('rejects a lessonId containing a path separator', async () => {
      const token = service.generateStreamToken('../../etc', 'user-1');
      await expect(
        service.streamHls('../../etc', token, mockResponse()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a segment that is an absolute path', async () => {
      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamSegment('lesson-A', '/etc/passwd', token, mockResponse()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('streamHls', () => {
    it('throws NotFoundException when the manifest does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const token = service.generateStreamToken('lesson-A', 'user-1');
      await expect(
        service.streamHls('lesson-A', token, mockResponse()),
      ).rejects.toThrow(NotFoundException);
    });

    it('streams the manifest when it exists', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      const pipeMock = jest.fn();
      mockedFs.createReadStream.mockReturnValue({ pipe: pipeMock } as any);
      const res = mockResponse();

      const token = service.generateStreamToken('lesson-A', 'user-1');
      await service.streamHls('lesson-A', token, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.apple.mpegurl',
      );
      expect(pipeMock).toHaveBeenCalledWith(res);
    });
  });

  describe('getDrmLicense', () => {
    it('returns a deterministic 32-character key for a keyId', () => {
      const result = service.getDrmLicense('key-1');
      expect(result.keyId).toBe('key-1');
      expect(result.key).toHaveLength(32);
      expect(service.getDrmLicense('key-1').key).toBe(result.key);
    });
  });
});

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Response } from 'express';

export interface StreamToken {
  lessonId: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class VideoStreamingService implements OnModuleInit {
  private readonly logger = new Logger(VideoStreamingService.name);
  private readonly storageBase: string;
  private readonly tokenSecret: string;
  private readonly tokenTtl = 3600; // 1 hour

  constructor(private readonly config: ConfigService) {
    this.storageBase = path.resolve(
      config.get<string>('VIDEO_STORAGE_PATH', './storage/videos'),
    );
    const secret = config.get<string>('VIDEO_TOKEN_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('VIDEO_TOKEN_SECRET must be set in production');
      }
      this.logger.warn(
        'VIDEO_TOKEN_SECRET not set — using an insecure default for local development only',
      );
    }
    this.tokenSecret = secret || 'video-secret-change-me';
  }

  onModuleInit() {
    if (!fs.existsSync(this.storageBase)) {
      fs.mkdirSync(this.storageBase, { recursive: true });
      this.logger.log('Video storage directory created');
    }
  }

  // Only allow simple path segments (letters, digits, dash, underscore, dot) with no traversal or separators.
  private assertSafePathSegment(segment: string): void {
    if (
      !segment ||
      segment.includes('..') ||
      /[/\\\0]/.test(segment) ||
      !/^[\w.-]+$/.test(segment)
    ) {
      throw new ForbiddenException('Invalid path segment');
    }
  }

  private resolveMediaPath(lessonId: string, ...parts: string[]): string {
    this.assertSafePathSegment(lessonId);
    parts.forEach((p) => this.assertSafePathSegment(p));
    const resolved = path.resolve(this.storageBase, lessonId, ...parts);
    if (
      resolved !== this.storageBase &&
      !resolved.startsWith(this.storageBase + path.sep)
    ) {
      throw new ForbiddenException('Invalid path');
    }
    return resolved;
  }

  generateStreamToken(lessonId: string, userId: string): string {
    const payload: StreamToken = {
      lessonId,
      userId,
      expiresAt: Date.now() + this.tokenTtl * 1000,
    };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.tokenSecret)
      .update(data)
      .digest('base64url');
    return `${data}.${sig}`;
  }

  verifyStreamToken(token: string): StreamToken {
    const [data, sig] = token.split('.');
    const expected = crypto
      .createHmac('sha256', this.tokenSecret)
      .update(data)
      .digest('base64url');
    if (sig !== expected) throw new ForbiddenException('Invalid stream token');
    const payload: StreamToken = JSON.parse(
      Buffer.from(data, 'base64url').toString(),
    );
    if (Date.now() > payload.expiresAt)
      throw new ForbiddenException('Stream token expired');
    return payload;
  }

  async streamHls(
    lessonId: string,
    token: string,
    res: Response,
  ): Promise<void> {
    const payload = this.verifyStreamToken(token);
    if (payload.lessonId !== lessonId)
      throw new ForbiddenException('Token mismatch');

    const manifestPath = this.resolveMediaPath(lessonId, 'index.m3u8');
    if (!fs.existsSync(manifestPath))
      throw new NotFoundException('HLS manifest not found');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(manifestPath).pipe(res);
  }

  async streamSegment(
    lessonId: string,
    segment: string,
    token: string,
    res: Response,
  ): Promise<void> {
    const payload = this.verifyStreamToken(token);
    if (payload.lessonId !== lessonId)
      throw new ForbiddenException('Token mismatch');
    const segmentPath = this.resolveMediaPath(lessonId, segment);
    if (!fs.existsSync(segmentPath))
      throw new NotFoundException('Segment not found');

    const stat = fs.statSync(segmentPath);
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(segmentPath).pipe(res);
  }

  async streamDash(
    lessonId: string,
    token: string,
    res: Response,
  ): Promise<void> {
    const payload = this.verifyStreamToken(token);
    if (payload.lessonId !== lessonId)
      throw new ForbiddenException('Token mismatch');

    const manifestPath = this.resolveMediaPath(lessonId, 'manifest.mpd');
    if (!fs.existsSync(manifestPath))
      throw new NotFoundException('DASH manifest not found');

    res.setHeader('Content-Type', 'application/dash+xml');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(manifestPath).pipe(res);
  }

  async streamRange(
    lessonId: string,
    token: string,
    rangeHeader: string,
    res: Response,
  ): Promise<void> {
    const payload = this.verifyStreamToken(token);
    if (payload.lessonId !== lessonId)
      throw new ForbiddenException('Token mismatch');
    const videoPath = this.resolveMediaPath(lessonId, 'video.mp4');
    if (!fs.existsSync(videoPath))
      throw new NotFoundException('Video not found');

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;

    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024, fileSize - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(videoPath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(videoPath).pipe(res);
    }
  }

  getDrmLicense(keyId: string): { key: string; keyId: string } {
    // Stub: in production integrate with Widevine/PlayReady/FairPlay
    const key = crypto.createHash('sha256').update(`${keyId}:${this.tokenSecret}`).digest('hex').slice(0, 32);
    return { keyId, key };
  }
}

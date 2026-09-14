import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Request,
  Post,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Response, Request as ExpressRequest } from 'express';
import { VideoStreamingService } from './video-streaming.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('video-streaming')
@Controller('video')
export class VideoStreamingController {
  constructor(private readonly videoService: VideoStreamingService) {}

  @Post('token/:lessonId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get a time-limited stream token for a lesson' })
  getToken(@Param('lessonId') lessonId: string, @Request() req) {
    const token = this.videoService.generateStreamToken(lessonId, req.user.id);
    return { token };
  }

  @Get(':lessonId/hls')
  @ApiOperation({ summary: 'Stream HLS manifest' })
  @ApiQuery({ name: 'token', required: true })
  streamHls(@Param('lessonId') lessonId: string, @Query('token') token: string, @Res() res: Response) {
    return this.videoService.streamHls(lessonId, token, res);
  }

  @Get(':lessonId/hls/:segment')
  @ApiOperation({ summary: 'Stream HLS segment' })
  @ApiQuery({ name: 'token', required: true })
  streamSegment(
    @Param('lessonId') lessonId: string,
    @Param('segment') segment: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    return this.videoService.streamSegment(lessonId, segment, token, res);
  }

  @Get(':lessonId/dash')
  @ApiOperation({ summary: 'Stream DASH manifest' })
  @ApiQuery({ name: 'token', required: true })
  streamDash(@Param('lessonId') lessonId: string, @Query('token') token: string, @Res() res: Response) {
    return this.videoService.streamDash(lessonId, token, res);
  }

  @Get(':lessonId/mp4')
  @ApiOperation({ summary: 'Stream MP4 with byte-range support' })
  @ApiQuery({ name: 'token', required: true })
  streamMp4(
    @Param('lessonId') lessonId: string,
    @Query('token') token: string,
    @Req() req: ExpressRequest,
    @Res() res: Response,
  ) {
    return this.videoService.streamRange(lessonId, token, req.headers.range, res);
  }

  @Post('drm/license/:keyId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get DRM license key' })
  getDrmLicense(@Param('keyId') keyId: string) {
    return this.videoService.getDrmLicense(keyId);
  }
}

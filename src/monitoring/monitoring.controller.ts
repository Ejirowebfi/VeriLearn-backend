import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { MonitoringService } from './monitoring.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('monitoring')
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @SkipThrottle()
  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  async metrics(@Res() res: Response) {
    res.setHeader('Content-Type', this.monitoringService.getContentType());
    res.send(await this.monitoringService.getMetrics());
  }

  @Get('audit')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get audit logs (admin)' })
  getAuditLogs(@Query('userId') userId?: string, @Query('limit') limit = 50) {
    return this.monitoringService.getAuditLogs(userId, +limit);
  }

  @Get('audit/me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get my audit logs' })
  getMyAuditLogs(@Request() req) {
    return this.monitoringService.getAuditLogs(req.user.id);
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as client from 'prom-client';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);

  // Prometheus metrics
  readonly httpRequestsTotal: client.Counter<string>;
  readonly httpRequestDuration: client.Histogram<string>;
  readonly activeConnections: client.Gauge<string>;
  readonly dbQueryDuration: client.Histogram<string>;

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {
    client.collectDefaultMetrics({ prefix: 'verilearn_' });

    this.httpRequestsTotal = new client.Counter({
      name: 'verilearn_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status'],
    });

    this.httpRequestDuration = new client.Histogram({
      name: 'verilearn_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    });

    this.activeConnections = new client.Gauge({
      name: 'verilearn_active_connections',
      help: 'Active WebSocket/HTTP connections',
    });

    this.dbQueryDuration = new client.Histogram({
      name: 'verilearn_db_query_duration_seconds',
      help: 'Database query duration',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    });
  }

  onModuleInit() {
    this.logger.log('Monitoring service initialized');
  }

  async getMetrics(): Promise<string> {
    return client.register.metrics();
  }

  getContentType(): string {
    return client.register.contentType;
  }

  async audit(entry: {
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
    success?: boolean;
  }): Promise<void> {
    try {
      const log = this.auditRepo.create({
        ...entry,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        success: entry.success ?? true,
      });
      await this.auditRepo.save(log);
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  async getAuditLogs(userId?: string, limit = 50): Promise<AuditLog[]> {
    const where = userId ? { userId } : {};
    return this.auditRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}

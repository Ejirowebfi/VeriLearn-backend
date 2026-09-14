import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

@Injectable()
export class ConnectionPoolService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionPoolService.name);
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private readonly failureThreshold = 5;
  private readonly recoveryTimeout = 30000;
  private nextAttempt = Date.now();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    this.logger.log('Database connection pool initialized');
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt)
        throw new Error('Circuit breaker OPEN — database unavailable');
      this.state = CircuitState.HALF_OPEN;
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.recoveryTimeout;
      this.logger.error(`Circuit breaker OPEN — will retry at ${new Date(this.nextAttempt).toISOString()}`);
    }
  }

  getState() { return this.state; }
  isHealthy() { return this.dataSource.isInitialized && this.state !== CircuitState.OPEN; }
}

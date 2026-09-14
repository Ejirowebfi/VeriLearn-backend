import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MonitoringService } from '../../monitoring/monitoring.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(@Optional() private readonly monitoring?: MonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const { method, url } = req;
    const start = Date.now();
    const end = this.monitoring?.httpRequestDuration.startTimer({ method, route: url });

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          const status = res.statusCode;
          this.logger.log(`${method} ${url} ${status} — ${ms}ms`);
          end?.({ status: String(status) });
          this.monitoring?.httpRequestsTotal.inc({ method, route: url, status: String(status) });
        },
        error: (err) => {
          const ms = Date.now() - start;
          const status = err.status || 500;
          this.logger.error(`${method} ${url} ${status} — ${ms}ms`);
          end?.({ status: String(status) });
          this.monitoring?.httpRequestsTotal.inc({ method, route: url, status: String(status) });
        },
      }),
    );
  }
}

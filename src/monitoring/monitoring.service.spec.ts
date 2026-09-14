import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MonitoringService } from './monitoring.service';
import { AuditLog } from './entities/audit-log.entity';

const mockAuditRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

describe('MonitoringService', () => {
  let service: MonitoringService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitoringService,
        { provide: getRepositoryToken(AuditLog), useValue: mockAuditRepo },
      ],
    }).compile();
    service = module.get<MonitoringService>(MonitoringService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('audit', () => {
    it('persists an audit log entry with serialized metadata', async () => {
      mockAuditRepo.create.mockReturnValue({ id: 'log-1' });
      mockAuditRepo.save.mockResolvedValue({ id: 'log-1' });

      await service.audit({
        userId: 'user-1',
        action: 'LOGIN',
        resource: 'auth',
        metadata: { ip: '1.2.3.4' },
      });

      expect(mockAuditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'LOGIN',
          metadata: JSON.stringify({ ip: '1.2.3.4' }),
          success: true,
        }),
      );
      expect(mockAuditRepo.save).toHaveBeenCalled();
    });

    it('defaults success to true when not specified', async () => {
      mockAuditRepo.create.mockReturnValue({});
      mockAuditRepo.save.mockResolvedValue({});
      await service.audit({ action: 'X', resource: 'y' });
      expect(mockAuditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it('swallows errors instead of throwing', async () => {
      mockAuditRepo.create.mockReturnValue({});
      mockAuditRepo.save.mockRejectedValue(new Error('db down'));
      await expect(
        service.audit({ action: 'X', resource: 'y' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('getAuditLogs', () => {
    it('filters by userId when provided', async () => {
      mockAuditRepo.find.mockResolvedValue([]);
      await service.getAuditLogs('user-1', 10);
      expect(mockAuditRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
        take: 10,
      });
    });

    it('returns all logs when no userId is given', async () => {
      mockAuditRepo.find.mockResolvedValue([]);
      await service.getAuditLogs();
      expect(mockAuditRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        take: 50,
      });
    });
  });

  describe('metrics', () => {
    it('exposes Prometheus metrics text and content type', async () => {
      const metrics = await service.getMetrics();
      expect(typeof metrics).toBe('string');
      expect(service.getContentType()).toContain('text/plain');
    });
  });
});

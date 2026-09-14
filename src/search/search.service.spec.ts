import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';

const mockEsClient = {
  ping: jest.fn(),
  indices: { exists: jest.fn(), create: jest.fn() },
  index: jest.fn(),
  delete: jest.fn(),
  search: jest.fn(),
};

jest.mock('@elastic/elasticsearch', () => ({
  Client: jest.fn().mockImplementation(() => mockEsClient),
}));

const mockConfigService = {
  get: jest.fn((_key: string, fallback?: any) => fallback),
};

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<SearchService>(SearchService);
  });

  describe('onModuleInit', () => {
    it('creates missing indices when Elasticsearch is reachable', async () => {
      mockEsClient.ping.mockResolvedValue(true);
      mockEsClient.indices.exists.mockResolvedValue(false);
      mockEsClient.indices.create.mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(mockEsClient.indices.create).toHaveBeenCalledWith({
        index: 'courses',
      });
      expect(mockEsClient.indices.create).toHaveBeenCalledWith({
        index: 'users',
      });
    });

    it('degrades gracefully when Elasticsearch is unreachable', async () => {
      mockEsClient.ping.mockRejectedValue(new Error('down'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('indexDocument / deleteDocument', () => {
    it('does not throw when indexing fails', async () => {
      mockEsClient.index.mockRejectedValue(new Error('fail'));
      await expect(
        service.indexDocument('courses', 'c1', { title: 'x' }),
      ).resolves.toBeUndefined();
    });

    it('does not throw when deletion fails', async () => {
      mockEsClient.delete.mockRejectedValue(new Error('fail'));
      await expect(
        service.deleteDocument('courses', 'c1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('search', () => {
    it('maps hits with id and a numeric total', async () => {
      mockEsClient.search.mockResolvedValue({
        hits: {
          hits: [{ _id: 'c1', _source: { title: 'Stellar Basics' } }],
          total: { value: 1 },
        },
      });
      const result = await service.searchCourses('stellar');
      expect(result.total).toBe(1);
      expect(result.hits).toEqual([{ id: 'c1', title: 'Stellar Basics' }]);
    });

    it('returns an empty result set when Elasticsearch throws', async () => {
      mockEsClient.search.mockRejectedValue(new Error('down'));
      const result = await service.searchCourses('stellar');
      expect(result).toEqual({ hits: [], total: 0 });
    });
  });
});

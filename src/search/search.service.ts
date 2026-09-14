import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

export interface SearchResult<T> {
  hits: T[];
  total: number;
}

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private client: Client;

  constructor(private readonly config: ConfigService) {
    this.client = new Client({
      node: config.get<string>('ELASTICSEARCH_URL', 'http://localhost:9200'),
      auth: config.get('ELASTICSEARCH_USERNAME')
        ? {
            username: config.get('ELASTICSEARCH_USERNAME'),
            password: config.get('ELASTICSEARCH_PASSWORD'),
          }
        : undefined,
    });
  }

  async onModuleInit() {
    try {
      await this.client.ping();
      this.logger.log('Elasticsearch connected');
      await this.ensureIndices();
    } catch {
      this.logger.warn('Elasticsearch not available — search features degraded');
    }
  }

  private async ensureIndices() {
    const indices = ['courses', 'users'];
    for (const index of indices) {
      const exists = await this.client.indices.exists({ index });
      if (!exists) {
        await this.client.indices.create({ index });
        this.logger.log(`Created index: ${index}`);
      }
    }
  }

  async indexDocument(index: string, id: string, body: Record<string, any>): Promise<void> {
    try {
      await this.client.index({ index, id, document: body });
    } catch (err) {
      this.logger.error(`Failed to index document ${id} in ${index}`, err);
    }
  }

  async deleteDocument(index: string, id: string): Promise<void> {
    try {
      await this.client.delete({ index, id });
    } catch (err) {
      this.logger.error(`Failed to delete document ${id} from ${index}`, err);
    }
  }

  async search<T>(index: string, query: string, from = 0, size = 10): Promise<SearchResult<T>> {
    try {
      const response = await this.client.search<T>({
        index,
        from,
        size,
        query: {
          multi_match: {
            query,
            fields: ['title^3', 'description', 'category', 'tags'],
            fuzziness: 'AUTO',
          },
        },
      });
      return {
        hits: response.hits.hits.map((h) => ({ id: h._id, ...h._source } as T)),
        total: typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value ?? 0,
      };
    } catch (err) {
      this.logger.error('Search failed', err);
      return { hits: [], total: 0 };
    }
  }

  async searchCourses(query: string, from = 0, size = 10) {
    return this.search('courses', query, from, size);
  }
}

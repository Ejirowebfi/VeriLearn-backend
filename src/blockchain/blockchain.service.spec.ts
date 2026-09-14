import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { BlockchainService } from './blockchain.service';
import { Credential } from './entities/credential.entity';
import { Enrollment } from '../courses/entities/course.entity';
import { MonitoringService } from '../monitoring/monitoring.service';

const mockServer = {
  loadAccount: jest.fn(),
  submitTransaction: jest.fn(),
  transactions: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => mockServer),
    },
  };
});

const mockCredentialRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

const mockEnrollmentRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockMonitoring = {
  audit: jest.fn().mockResolvedValue(undefined),
};

const issuer = StellarSdk.Keypair.random();
const configValues: Record<string, any> = {
  'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
  'stellar.network': 'testnet',
  'stellar.secretKey': issuer.secret(),
};

const mockConfigService = {
  get: jest.fn((key: string) => configValues[key]),
};

describe('BlockchainService', () => {
  let service: BlockchainService;

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues['stellar.secretKey'] = issuer.secret();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: getRepositoryToken(Credential),
          useValue: mockCredentialRepo,
        },
        {
          provide: getRepositoryToken(Enrollment),
          useValue: mockEnrollmentRepo,
        },
        { provide: MonitoringService, useValue: mockMonitoring },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
  });

  describe('issueCredential', () => {
    it('throws ForbiddenException when user is not enrolled', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.issueCredential('user-1', 'course-1', 'GPUBLICKEY'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockServer.loadAccount).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when enrollment is not completed', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        courseId: 'course-1',
        isCompleted: false,
      });
      await expect(
        service.issueCredential('user-1', 'course-1', 'GPUBLICKEY'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockServer.loadAccount).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when Stellar secret key is not configured', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        courseId: 'course-1',
        isCompleted: true,
      });
      configValues['stellar.secretKey'] = '';

      await expect(
        service.issueCredential('user-1', 'course-1', 'GPUBLICKEY'),
      ).rejects.toThrow(BadRequestException);
    });

    it('issues a credential and records the tx hash on success', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        courseId: 'course-1',
        isCompleted: true,
      });
      mockServer.loadAccount.mockResolvedValue(
        new StellarSdk.Account(issuer.publicKey(), '100'),
      );
      mockServer.submitTransaction.mockResolvedValue({ hash: 'tx-hash-123' });

      const created = {
        userId: 'user-1',
        courseId: 'course-1',
        stellarPublicKey: 'GPUBLICKEY',
        txHash: 'tx-hash-123',
        isVerified: true,
      };
      mockCredentialRepo.create.mockReturnValue(created);
      mockCredentialRepo.save.mockResolvedValue({ id: 'cred-1', ...created });
      mockEnrollmentRepo.update.mockResolvedValue(undefined);

      const result = await service.issueCredential(
        'user-1',
        'course-1',
        'GPUBLICKEY',
      );

      expect(result).toEqual({ id: 'cred-1', ...created });
      expect(mockEnrollmentRepo.update).toHaveBeenCalledWith(
        { courseId: 'course-1', userId: 'user-1' },
        { credentialTxHash: 'tx-hash-123' },
      );
      expect(mockMonitoring.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ISSUE_CREDENTIAL', success: true }),
      );
    });

    it('saves an unverified credential when the Stellar submission fails', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        courseId: 'course-1',
        isCompleted: true,
      });
      mockServer.loadAccount.mockRejectedValue(new Error('horizon down'));

      const created = {
        userId: 'user-1',
        courseId: 'course-1',
        stellarPublicKey: 'GPUBLICKEY',
        isVerified: false,
      };
      mockCredentialRepo.create.mockReturnValue(created);
      mockCredentialRepo.save.mockResolvedValue({ id: 'cred-2', ...created });

      const result = await service.issueCredential(
        'user-1',
        'course-1',
        'GPUBLICKEY',
      );

      expect(result.isVerified).toBe(false);
      expect(mockMonitoring.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ISSUE_CREDENTIAL_FAILED',
          success: false,
        }),
      );
    });
  });

  describe('verifyCredential', () => {
    it('returns true when the transaction is found', async () => {
      mockServer.transactions.mockReturnValue({
        transaction: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue({ id: 'tx-hash-123' }),
        }),
      });
      await expect(service.verifyCredential('tx-hash-123')).resolves.toBe(true);
    });

    it('returns false when the lookup throws', async () => {
      mockServer.transactions.mockReturnValue({
        transaction: jest.fn().mockReturnValue({
          call: jest.fn().mockRejectedValue(new Error('not found')),
        }),
      });
      await expect(service.verifyCredential('bad-hash')).resolves.toBe(false);
    });
  });

  describe('getCredentialsByUser', () => {
    it('delegates to the credential repository', async () => {
      mockCredentialRepo.find.mockResolvedValue([{ id: 'cred-1' }]);
      const result = await service.getCredentialsByUser('user-1');
      expect(result).toEqual([{ id: 'cred-1' }]);
      expect(mockCredentialRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('getAccountBalance', () => {
    it('returns balances for a valid public key', async () => {
      mockServer.loadAccount.mockResolvedValue({
        balances: [{ asset_type: 'native', balance: '100' }],
      });
      const result = await service.getAccountBalance(issuer.publicKey());
      expect(result).toEqual([{ asset_type: 'native', balance: '100' }]);
    });

    it('throws BadRequestException for an invalid public key', async () => {
      mockServer.loadAccount.mockRejectedValue(new Error('not found'));
      await expect(service.getAccountBalance('bad-key')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createKeypair', () => {
    it('returns a valid public/secret Stellar keypair', () => {
      const result = service.createKeypair();
      expect(result.publicKey).toMatch(/^G/);
      expect(result.secretKey).toMatch(/^S/);
    });
  });
});

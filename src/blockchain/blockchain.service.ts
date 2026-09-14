import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Credential } from './entities/credential.entity';
import { Enrollment } from '../courses/entities/course.entity';
import { MonitoringService } from '../monitoring/monitoring.service';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly network: string;
  private readonly networkPassphrase: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Credential) private readonly credentialRepo: Repository<Credential>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    private readonly monitoring: MonitoringService,
  ) {
    const horizonUrl = config.get<string>('stellar.horizonUrl');
    this.network = config.get<string>('stellar.network');
    this.networkPassphrase = this.network === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
  }

  async issueCredential(userId: string, courseId: string, stellarPublicKey: string): Promise<Credential> {
    const secretKey = this.config.get<string>('stellar.secretKey');
    if (!secretKey) throw new BadRequestException('Stellar secret key not configured');

    try {
      const issuerKeypair = StellarSdk.Keypair.fromSecret(secretKey);
      const account = await this.server.loadAccount(issuerKeypair.publicKey());

      const metadata = JSON.stringify({ userId, courseId, issuedAt: new Date().toISOString(), platform: 'VeriLearn' });

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.manageData({
          name: `verilearn:credential:${courseId}`,
          value: Buffer.from(metadata).slice(0, 64),
          source: issuerKeypair.publicKey(),
        }))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);
      const result = await this.server.submitTransaction(transaction);

      const credential = this.credentialRepo.create({
        userId,
        courseId,
        stellarPublicKey,
        txHash: result.hash,
        isVerified: true,
        metadata,
      });
      const saved = await this.credentialRepo.save(credential);
      await this.enrollmentRepo.update({ courseId, userId }, { credentialTxHash: result.hash });
      this.monitoring.audit({ userId, action: 'ISSUE_CREDENTIAL', resource: 'credential', resourceId: saved.id, success: true }).catch(() => null);
      return saved;
    } catch (err) {
      this.logger.error('Failed to issue credential', err);
      const credential = this.credentialRepo.create({ userId, courseId, stellarPublicKey, isVerified: false });
      const saved = await this.credentialRepo.save(credential);
      this.monitoring.audit({ userId, action: 'ISSUE_CREDENTIAL_FAILED', resource: 'credential', resourceId: saved.id, success: false }).catch(() => null);
      return saved;
    }
  }

  async verifyCredential(txHash: string): Promise<boolean> {
    try {
      const tx = await this.server.transactions().transaction(txHash).call();
      return !!tx;
    } catch {
      return false;
    }
  }

  async getCredentialsByUser(userId: string): Promise<Credential[]> {
    return this.credentialRepo.find({ where: { userId } });
  }

  async getAccountBalance(publicKey: string): Promise<StellarSdk.Horizon.HorizonApi.BalanceLine[]> {
    try {
      const account = await this.server.loadAccount(publicKey);
      return account.balances;
    } catch (err) {
      this.logger.error(`Failed to load account ${publicKey}`, err);
      throw new BadRequestException('Invalid Stellar public key or account not found');
    }
  }

  createKeypair(): { publicKey: string; secretKey: string } {
    const keypair = StellarSdk.Keypair.random();
    return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
  }
}

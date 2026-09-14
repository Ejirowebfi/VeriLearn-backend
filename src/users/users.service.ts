import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { User } from './entities/user.entity';
import {
  CreateUserDto,
  UpdateUserDto,
  ChangePasswordDto,
} from './dto/user.dto';
import { MonitoringService } from '../monitoring/monitoring.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly monitoring: MonitoringService,
  ) {}

  async create(
    dto: CreateUserDto & { emailVerificationToken?: string },
  ): Promise<User> {
    const exists = await this.repo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');
    const hashed = await bcrypt.hash(dto.password, 12);
    const user = this.repo.create({ ...dto, password: hashed });
    return this.repo.save(user);
  }

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.repo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  async findByResetToken(token: string): Promise<User | null> {
    return this.repo.findOne({ where: { passwordResetToken: token } });
  }

  async findByEmailVerificationToken(token: string): Promise<User | null> {
    return this.repo.findOne({ where: { emailVerificationToken: token } });
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    Object.assign(user, dto);
    return this.repo.save(user);
  }

  async setPasswordResetToken(
    id: string,
    token: string,
    expires: Date,
  ): Promise<void> {
    await this.repo.update(id, {
      passwordResetToken: token,
      passwordResetExpires: expires,
    });
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const hashed = await bcrypt.hash(newPassword, 12);
    await this.repo.update(id, {
      password: hashed,
      passwordResetToken: null,
      passwordResetExpires: null,
    });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.repo.update(id, {
      isEmailVerified: true,
      emailVerificationToken: null,
    });
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findById(id);
    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new BadRequestException('Current password is incorrect');
    user.password = await bcrypt.hash(dto.newPassword, 12);
    await this.repo.save(user);
    this.monitoring
      .audit({
        userId: id,
        action: 'CHANGE_PASSWORD',
        resource: 'user',
        success: true,
      })
      .catch(() => null);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.repo.remove(user);
  }

  async generateMfaSecret(
    userId: string,
  ): Promise<{ secret: string; qrCode: string }> {
    const user = await this.findById(userId);
    const secret = authenticator.generateSecret();
    const otpAuthUrl = authenticator.keyuri(user.email, 'VeriLearn', secret);
    const qrCode = await qrcode.toDataURL(otpAuthUrl);
    user.mfaSecret = secret;
    await this.repo.save(user);
    return { secret, qrCode };
  }

  async enableMfa(userId: string, token: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user.mfaSecret)
      throw new BadRequestException('MFA secret not generated');
    const valid = authenticator.verify({ token, secret: user.mfaSecret });
    if (!valid) throw new BadRequestException('Invalid MFA token');
    user.isMfaEnabled = true;
    await this.repo.save(user);
  }

  async disableMfa(userId: string): Promise<void> {
    const user = await this.findById(userId);
    user.isMfaEnabled = false;
    user.mfaSecret = null;
    await this.repo.save(user);
  }

  async verifyMfaToken(userId: string, token: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user.isMfaEnabled || !user.mfaSecret) return false;
    return authenticator.verify({ token, secret: user.mfaSecret });
  }
}

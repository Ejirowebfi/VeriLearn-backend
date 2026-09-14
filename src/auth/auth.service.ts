import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { User } from '../users/entities/user.entity';
import { RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly monitoring: MonitoringService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    return valid ? user : null;
  }

  async register(dto: RegisterDto) {
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = await this.usersService.create({
      ...dto,
      emailVerificationToken: verificationToken,
    });
    this.emailService.sendWelcome(user.email, user.firstName).catch(() => null);
    this.emailService
      .sendEmailVerification(user.email, verificationToken)
      .catch(() => null);
    this.monitoring
      .audit({
        userId: user.id,
        action: 'REGISTER',
        resource: 'auth',
        success: true,
      })
      .catch(() => null);
    return this.generateTokens(user);
  }

  async login(user: User) {
    if (user.isMfaEnabled) {
      return { requiresMfa: true, userId: user.id };
    }
    this.monitoring.audit({ userId: user.id, action: 'LOGIN', resource: 'auth', success: true }).catch(() => null);
    return this.generateTokens(user);
  }

  async verifyMfaAndLogin(userId: string, token: string) {
    const valid = await this.usersService.verifyMfaToken(userId, token);
    if (!valid) {
      this.monitoring.audit({ userId, action: 'MFA_FAILED', resource: 'auth', success: false }).catch(() => null);
      throw new UnauthorizedException('Invalid MFA token');
    }
    const user = await this.usersService.findById(userId);
    this.monitoring.audit({ userId, action: 'MFA_LOGIN', resource: 'auth', success: true }).catch(() => null);
    return this.generateTokens(user);
  }

  async logout(userId: string): Promise<{ message: string }> {
    // Stateless JWT — instruct client to discard. Log the action.
    this.monitoring.audit({ userId, action: 'LOGOUT', resource: 'auth', success: true }).catch(() => null);
    return { message: 'Logged out successfully' };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
      const user = await this.usersService.findById(payload.sub);
      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return { message: 'If the email exists, a reset link has been sent' };
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 3600 * 1000); // 1 hour
    await this.usersService.setPasswordResetToken(user.id, hashedToken, expires);
    this.emailService.sendPasswordReset(user.email, rawToken).catch(() => null);
    this.monitoring.audit({ userId: user.id, action: 'FORGOT_PASSWORD', resource: 'auth', success: true }).catch(() => null);
    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.usersService.findByResetToken(hashed);
    if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    await this.usersService.resetPassword(user.id, newPassword);
    this.monitoring.audit({ userId: user.id, action: 'RESET_PASSWORD', resource: 'auth', success: true }).catch(() => null);
    return { message: 'Password reset successfully' };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmailVerificationToken(token);
    if (!user) throw new BadRequestException('Invalid verification token');
    await this.usersService.markEmailVerified(user.id);
    return { message: 'Email verified successfully' };
  }

  private generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      }),
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    };
  }
}

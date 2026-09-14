import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { UserRole } from '../users/entities/user.entity';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  password: 'hashed',
  role: UserRole.STUDENT,
  isMfaEnabled: false,
  passwordResetExpires: null,
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            create: jest.fn(),
            findByEmail: jest.fn(),
            findById: jest.fn(),
            verifyMfaToken: jest.fn(),
            setPasswordResetToken: jest.fn(),
            resetPassword: jest.fn(),
            findByResetToken: jest.fn(),
            findByEmailVerificationToken: jest.fn(),
            markEmailVerified: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-token'),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('secret') },
        },
        {
          provide: EmailService,
          useValue: {
            sendWelcome: jest.fn().mockResolvedValue(undefined),
            sendEmailVerification: jest.fn().mockResolvedValue(undefined),
            sendPasswordReset: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MonitoringService,
          useValue: { audit: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
  });

  describe('validateUser', () => {
    it('returns user when credentials are valid', async () => {
      const hashed = await bcrypt.hash('password123', 10);
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        password: hashed,
      } as any);
      const result = await service.validateUser(
        'test@example.com',
        'password123',
      );
      expect(result).toBeDefined();
      expect(result.email).toBe('test@example.com');
    });

    it('returns null when password is wrong', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        password: 'different-hash',
      } as any);
      const result = await service.validateUser('test@example.com', 'wrong');
      expect(result).toBeNull();
    });

    it('returns null when user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const result = await service.validateUser(
        'notfound@example.com',
        'password',
      );
      expect(result).toBeNull();
    });
  });

  describe('register', () => {
    it('creates user and returns tokens', async () => {
      usersService.create.mockResolvedValue(mockUser as any);
      const result = await service.register({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        password: 'password123',
      });
      expect(usersService.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-token');
      expect(result.user.email).toBe('test@example.com');
    });
  });

  describe('login', () => {
    it('returns tokens when MFA is disabled', async () => {
      const result = await service.login(mockUser as any);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('returns MFA challenge when MFA is enabled', async () => {
      const result = await service.login({
        ...mockUser,
        isMfaEnabled: true,
      } as any);
      expect(result).toEqual({ requiresMfa: true, userId: 'user-1' });
    });
  });

  describe('refreshToken', () => {
    it('throws UnauthorizedException on invalid token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });
      await expect(service.refreshToken('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns new tokens on valid refresh token', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@example.com',
        role: UserRole.STUDENT,
      });
      usersService.findById.mockResolvedValue(mockUser as any);
      const result = await service.refreshToken('valid-refresh-token');
      expect(result.accessToken).toBe('mock-token');
    });
  });

  describe('forgotPassword', () => {
    it('sends reset email when user exists', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      usersService.setPasswordResetToken.mockResolvedValue(undefined);
      const result = await service.forgotPassword('test@example.com');
      expect(usersService.setPasswordResetToken).toHaveBeenCalled();
      expect(result.message).toContain('reset link');
    });

    it('returns same message when user does not exist (prevents enumeration)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const result = await service.forgotPassword('nonexistent@example.com');
      expect(result.message).toContain('reset link');
      expect(usersService.setPasswordResetToken).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('resets password with valid token', async () => {
      usersService.findByResetToken.mockResolvedValue({
        ...mockUser,
        passwordResetExpires: new Date(Date.now() + 60000),
      } as any);
      usersService.resetPassword.mockResolvedValue(undefined);
      const result = await service.resetPassword(
        'valid-token',
        'newPassword123',
      );
      expect(usersService.resetPassword).toHaveBeenCalled();
      expect(result.message).toContain('successfully');
    });

    it('throws on expired token', async () => {
      usersService.findByResetToken.mockResolvedValue({
        ...mockUser,
        passwordResetExpires: new Date(Date.now() - 60000),
      } as any);
      await expect(
        service.resetPassword('expired-token', 'newPass'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on invalid token', async () => {
      usersService.findByResetToken.mockResolvedValue(null);
      await expect(service.resetPassword('invalid', 'newPass')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyEmail', () => {
    it('marks email as verified with valid token', async () => {
      usersService.findByEmailVerificationToken.mockResolvedValue(
        mockUser as any,
      );
      usersService.markEmailVerified.mockResolvedValue(undefined);
      const result = await service.verifyEmail('valid-token');
      expect(usersService.markEmailVerified).toHaveBeenCalledWith('user-1');
      expect(result.message).toContain('verified');
    });

    it('throws on invalid token', async () => {
      usersService.findByEmailVerificationToken.mockResolvedValue(null);
      await expect(service.verifyEmail('bad-token')).rejects.toThrow(BadRequestException);
    });
  });
});

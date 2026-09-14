import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User, UserRole } from './entities/user.entity';
import { MonitoringService } from '../monitoring/monitoring.service';

const mockUser: Partial<User> = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  password: 'hashed-password',
  role: UserRole.STUDENT,
  isMfaEnabled: false,
  isEmailVerified: false,
};

const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  increment: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
        {
          provide: MonitoringService,
          useValue: { audit: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a new user with hashed password', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue(mockUser);
      mockRepo.save.mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        password: 'plaintext',
      });

      expect(mockRepo.create).toHaveBeenCalled();
      const callArgs = mockRepo.create.mock.calls[0][0];
      expect(callArgs.password).not.toBe('plaintext');
      expect(result).toEqual(mockUser);
    });

    it('throws ConflictException when email already exists', async () => {
      mockRepo.findOne.mockResolvedValue(mockUser);
      await expect(service.create({
        email: 'test@example.com', firstName: 'A', lastName: 'B', password: 'pass',
      })).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('returns user when found', async () => {
      mockRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.findById('user-1');
      expect(result).toEqual(mockUser);
    });

    it('throws NotFoundException when not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('returns user when found', async () => {
      mockRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.findByEmail('test@example.com');
      expect(result).toEqual(mockUser);
    });

    it('returns null when not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const result = await service.findByEmail('missing@example.com');
      expect(result).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('changes password when current password is correct', async () => {
      const hashed = await bcrypt.hash('current-password', 10);
      mockRepo.findOne.mockResolvedValue({ ...mockUser, password: hashed });
      mockRepo.save.mockResolvedValue(mockUser);

      await service.changePassword('user-1', {
        currentPassword: 'current-password',
        newPassword: 'new-password',
      });

      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('throws BadRequestException when current password is wrong', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockUser, password: 'different-hash' });
      await expect(service.changePassword('user-1', {
        currentPassword: 'wrong-password',
        newPassword: 'new-password',
      })).rejects.toThrow(BadRequestException);
    });
  });

  describe('setPasswordResetToken', () => {
    it('updates user with reset token and expiry', async () => {
      const expires = new Date();
      mockRepo.update.mockResolvedValue({});
      await service.setPasswordResetToken('user-1', 'token-abc', expires);
      expect(mockRepo.update).toHaveBeenCalledWith('user-1', {
        passwordResetToken: 'token-abc',
        passwordResetExpires: expires,
      });
    });
  });

  describe('resetPassword', () => {
    it('hashes new password and clears reset token', async () => {
      mockRepo.update.mockResolvedValue({});
      await service.resetPassword('user-1', 'new-plain-password');
      const callArgs = mockRepo.update.mock.calls[0][1];
      expect(callArgs.password).not.toBe('new-plain-password');
      expect(callArgs.passwordResetToken).toBeNull();
      expect(callArgs.passwordResetExpires).toBeNull();
    });
  });

  describe('markEmailVerified', () => {
    it('sets isEmailVerified and clears token', async () => {
      mockRepo.update.mockResolvedValue({});
      await service.markEmailVerified('user-1');
      expect(mockRepo.update).toHaveBeenCalledWith('user-1', {
        isEmailVerified: true,
        emailVerificationToken: null,
      });
    });
  });

  describe('remove', () => {
    it('removes user', async () => {
      mockRepo.findOne.mockResolvedValue(mockUser);
      mockRepo.remove.mockResolvedValue(mockUser);
      await service.remove('user-1');
      expect(mockRepo.remove).toHaveBeenCalledWith(mockUser);
    });
  });
});

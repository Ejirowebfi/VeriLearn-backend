import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

const sendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

const configValues: Record<string, any> = {
  'email.host': 'smtp.test.com',
  'email.port': 587,
  'email.secure': false,
  'email.user': 'user',
  'email.password': 'pass',
  'email.from': 'noreply@verilearn.io',
  APP_URL: 'http://localhost:3000',
};

const mockConfigService = {
  get: jest.fn((key: string, fallback?: any) => configValues[key] ?? fallback),
};

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<EmailService>(EmailService);
  });

  it('sends a welcome email with the configured from address', async () => {
    sendMailMock.mockResolvedValue(undefined);
    await service.sendWelcome('a@test.com', 'Ada');
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@test.com',
        from: 'noreply@verilearn.io',
        subject: expect.stringContaining('Welcome'),
        html: expect.stringContaining('Ada'),
      }),
    );
  });

  it('includes the verification token in the email verification link', async () => {
    sendMailMock.mockResolvedValue(undefined);
    await service.sendEmailVerification('a@test.com', 'tok123');
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('token=tok123'),
      }),
    );
  });

  it('includes the reset token in the password reset link', async () => {
    sendMailMock.mockResolvedValue(undefined);
    await service.sendPasswordReset('a@test.com', 'reset123');
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('token=reset123'),
      }),
    );
  });

  it('includes the course title and tx hash in the completion email', async () => {
    sendMailMock.mockResolvedValue(undefined);
    await service.sendCourseCompletion(
      'a@test.com',
      'Ada',
      'Stellar 101',
      'tx-abc',
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Stellar 101'),
        html: expect.stringContaining('tx-abc'),
      }),
    );
  });

  it('does not throw when the SMTP send fails', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp down'));
    await expect(
      service.sendWelcome('a@test.com', 'Ada'),
    ).resolves.toBeUndefined();
  });
});

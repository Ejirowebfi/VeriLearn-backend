import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('email.host'),
      port: config.get<number>('email.port'),
      secure: config.get<boolean>('email.secure'),
      auth: {
        user: config.get<string>('email.user'),
        pass: config.get<string>('email.password'),
      },
    });
  }

  async send(options: EmailOptions): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('email.from'),
        ...options,
      });
      this.logger.log(`Email sent to ${options.to}`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${options.to}`, err);
    }
  }

  async sendWelcome(to: string, firstName: string): Promise<void> {
    await this.send({
      to,
      subject: 'Welcome to VeriLearn!',
      html: this.welcomeTemplate(firstName),
    });
  }

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const url = `${this.config.get('APP_URL', 'http://localhost:3000')}/api/v1/auth/verify-email?token=${token}`;
    await this.send({
      to,
      subject: 'Verify your VeriLearn email',
      html: this.verificationTemplate(url),
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const url = `${this.config.get('APP_URL', 'http://localhost:3000')}/reset-password?token=${token}`;
    await this.send({
      to,
      subject: 'Reset your VeriLearn password',
      html: this.passwordResetTemplate(url),
    });
  }

  async sendCourseCompletion(
    to: string,
    firstName: string,
    courseTitle: string,
    txHash: string,
  ): Promise<void> {
    await this.send({
      to,
      subject: `Congratulations! You completed "${courseTitle}"`,
      html: this.completionTemplate(firstName, courseTitle, txHash),
    });
  }

  private welcomeTemplate(firstName: string): string {
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#4F46E5">Welcome to VeriLearn, ${firstName}!</h1>
        <p>Your blockchain-verified learning journey starts now.</p>
        <p>Explore courses and earn on-chain credentials on the Stellar network.</p>
        <a href="${this.config.get('APP_URL', 'http://localhost:3000')}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Get Started</a>
      </div>`;
  }

  private verificationTemplate(url: string): string {
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#4F46E5">Verify your email</h2>
        <p>Click the button below to verify your VeriLearn account.</p>
        <a href="${url}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Verify Email</a>
        <p style="color:#666;font-size:12px">Link expires in 24 hours.</p>
      </div>`;
  }

  private passwordResetTemplate(url: string): string {
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#4F46E5">Reset your password</h2>
        <p>Click below to reset your VeriLearn password. This link expires in 1 hour.</p>
        <a href="${url}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Reset Password</a>
        <p style="color:#666;font-size:12px">If you didn't request this, ignore this email.</p>
      </div>`;
  }

  private completionTemplate(firstName: string, courseTitle: string, txHash: string): string {
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#4F46E5">🎉 Course Completed!</h2>
        <p>Congratulations ${firstName}! You've completed <strong>${courseTitle}</strong>.</p>
        <p>Your credential has been issued on the Stellar blockchain.</p>
        <p><strong>Transaction Hash:</strong> <code>${txHash}</code></p>
        <a href="https://stellar.expert/explorer/testnet/tx/${txHash}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">View on Stellar</a>
      </div>`;
  }
}

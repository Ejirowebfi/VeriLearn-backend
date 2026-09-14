import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() password: string;
}

export class RegisterDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() firstName: string;
  @ApiProperty() @IsString() lastName: string;
  @ApiProperty() @IsString() @MinLength(8) password: string;
}

export class VerifyMfaLoginDto {
  @ApiProperty() @IsString() userId: string;
  @ApiProperty() @IsString() token: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() resetToken: string;
  @ApiProperty() @IsString() @MinLength(8) newPassword: string;
}

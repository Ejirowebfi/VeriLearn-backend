import { registerAs } from '@nestjs/config';

function requireSecret(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set in production`);
  }
  return fallback;
}

export default registerAs('jwt', () => ({
  secret: requireSecret(
    process.env.JWT_SECRET,
    'change-me-in-production',
    'JWT_SECRET',
  ),
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  refreshSecret: requireSecret(
    process.env.JWT_REFRESH_SECRET,
    'refresh-change-me',
    'JWT_REFRESH_SECRET',
  ),
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
}));

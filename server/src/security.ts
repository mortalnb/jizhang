import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const randomToken = () => crypto.randomBytes(32).toString('base64url');

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

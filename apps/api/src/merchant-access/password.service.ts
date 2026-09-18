import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Node/OpenSSL scrypt, OWASP N=2^17, r=8, p=1. One concurrent derivation
// bounds memory on the 512 MiB API; do not queue unbounded password work.
@Injectable()
export class PasswordService {
  private busy = false;

  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    if (this.busy)
      throw new HttpException('Tente novamente em alguns instantes.', 429);
    this.busy = true;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(
          password,
          salt,
          64,
          { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
          (error, key) => {
            if (error) reject(error);
            else resolve(key);
          },
        );
      });
    } finally {
      this.busy = false;
    }
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await this.derive(password, salt);
    return `scrypt-v1$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, stored: string | null): Promise<boolean> {
    const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(
      stored ?? '',
    );
    // Unknown/disabled users still do the same password work. Never fall back
    // to plaintext or weaker hashing if a stored value is malformed.
    const salt = match ? Buffer.from(match[1], 'hex') : Buffer.alloc(16);
    const expected = match ? Buffer.from(match[2], 'hex') : Buffer.alloc(64);
    const actual = await this.derive(password, salt);
    return timingSafeEqual(actual, expected) && match !== null;
  }
}

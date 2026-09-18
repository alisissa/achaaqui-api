import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PasswordService } from '../src/merchant-access/password.service';
import {
  SetMerchantLoginDto,
  MerchantLoginDto,
} from '../src/merchant-access/merchant-access.dto';
import { hashSessionToken } from '../src/merchant-access/merchant-access.service';
import { randomBytes } from 'node:crypto';

describe('merchant password security', () => {
  it('salts one-way scrypt hashes and rejects incorrect or malformed hashes', async () => {
    const passwords = new PasswordService();
    const password = randomBytes(24).toString('base64url');
    const a = await passwords.hash(password);
    const b = await passwords.hash(password);
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
    expect(await passwords.verify(password, a)).toBe(true);
    expect(await passwords.verify('wrong', a)).toBe(false);
    expect(await passwords.verify(password, password)).toBe(false);
    expect(await passwords.verify(password, null)).toBe(false);
  }, 10000);

  it('bounds expensive password concurrency instead of allocating unbounded memory', async () => {
    const passwords = new PasswordService();
    const first = passwords.verify('wrong', null);
    await expect(passwords.verify('wrong', null)).rejects.toMatchObject({
      status: 429,
    });
    await first;
  });

  it('requires a long password when provisioning and never trims passwords', async () => {
    const short = plainToInstance(SetMerchantLoginDto, {
      username: ' Store.One ',
      password: 'short',
    });
    expect(short.username).toBe('store.one');
    expect(
      (await validate(short)).some((error) => error.property === 'password'),
    ).toBe(true);
    const valid = plainToInstance(SetMerchantLoginDto, {
      username: 'store.one',
      password: ' two words and spaces ',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.password).toBe(' two words and spaces ');
    expect(
      await validate(
        plainToInstance(MerchantLoginDto, {
          username: 'bad/user',
          password: 'x',
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('stores only a fixed-length token digest', () => {
    const token = randomBytes(32).toString('base64url');
    expect(token).toHaveLength(43);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

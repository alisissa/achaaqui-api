import { Logger, type ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

describe('credential error redaction', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    '/v1/merchant/auth/login',
    '/V1/MERCHANT/AUTH/LOGIN/',
    '/v1/admin/merchants/test/login',
    '/V1/ADMIN/MERCHANTS/test/LOGIN/',
    '/v1/merchant/imports/photo',
    '/V1/MERCHANT/IMPORTS/PHOTO/',
    '/v1/merchant/imports/test/commit',
  ])('never logs credential operation stacks for %s', (path) => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnValue({ json }) };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const error = new Error(
      'simulated ORM arguments containing a password hash',
    );
    new AllExceptionsFilter().catch(error, host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(log).toHaveBeenCalledWith(expect.any(String), undefined);
    expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
    expect(JSON.stringify(json.mock.calls)).not.toContain(error.message);
  });
});

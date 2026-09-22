import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import { ActorId } from '../admin-auth/admin-actor';
import { MerchantIdParamDto } from '../merchants/merchant-offers.dto';
import { CurrentMerchant, type MerchantActor } from './merchant-actor';
import { MerchantAccessGuard } from './merchant-access.guard';
import { MerchantAccessService } from './merchant-access.service';
import {
  MerchantLoginDto,
  DeleteMerchantLoginDto,
  MerchantLoginStatusDto,
  SetMerchantLoginDto,
  type MerchantLoginResponseDto,
  type MerchantLoginConfigurationDto,
  type MerchantSessionDto,
} from './merchant-access.dto';

@ApiExcludeController()
@Controller('merchant/auth')
export class MerchantAuthController {
  constructor(private readonly access: MerchantAccessService) {}

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() input: MerchantLoginDto,
  ): Promise<MerchantLoginResponseDto> {
    return await this.access.login(input);
  }

  @Get('me')
  @UseGuards(MerchantAccessGuard)
  async me(
    @CurrentMerchant() actor: MerchantActor,
  ): Promise<MerchantSessionDto> {
    return await this.access.me(actor);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(MerchantAccessGuard)
  async logout(@CurrentMerchant() actor: MerchantActor): Promise<void> {
    await this.access.logout(actor);
  }
}

@ApiExcludeController()
@UseGuards(AdminApiKeyGuard)
@Controller('admin/merchants/:merchantId/login')
export class AdminMerchantLoginController {
  constructor(private readonly access: MerchantAccessService) {}

  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  async deleteLogin(
    @Param() params: MerchantIdParamDto,
    @Body() input: DeleteMerchantLoginDto,
    @ActorId() actorId: string,
  ): Promise<void> {
    await this.access.deleteLogin(params.merchantId, input, actorId);
  }

  @Get()
  async status(
    @Param() params: MerchantIdParamDto,
  ): Promise<MerchantLoginConfigurationDto> {
    return { login: await this.access.status(params.merchantId) };
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async provision(
    @Param() params: MerchantIdParamDto,
    @Body() input: SetMerchantLoginDto,
    @ActorId() actorId: string,
  ): Promise<{ username: string; active: boolean }> {
    return await this.access.provision(params.merchantId, input, actorId);
  }

  @Patch()
  @HttpCode(204)
  async setActive(
    @Param() params: MerchantIdParamDto,
    @Body() input: MerchantLoginStatusDto,
    @ActorId() actorId: string,
  ): Promise<void> {
    await this.access.setActive(params.merchantId, input.active, actorId);
  }
}

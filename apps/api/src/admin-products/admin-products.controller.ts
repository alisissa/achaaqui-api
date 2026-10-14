import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import { AdminProductsService } from './admin-products.service';
import {
  AdminProductQueryDto,
  type AdminProductList,
} from './admin-products.dto';

// Separate from admin/catalog/products, which serves the offer product picker.
@ApiTags('admin products')
@ApiBearerAuth('admin-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  async list(@Query() query: AdminProductQueryDto): Promise<AdminProductList> {
    return await this.products.list(query);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Paginated } from '../../common/types/paginated.type';
import { JWT_AUTH } from '../../config/swagger.config';
import { User } from '../../user/entities/user.entity';
import { UserService } from '../../user/services/user.service';
import { Role } from '../../user/types/user.types';
import { CourierDepositDto, MerchantPayoutDto } from '../dto/ledger-action.dto';
import {
  LedgerStatementDto,
  PaginatedLedgerBalancesDto,
} from '../dto/ledger-response.dto';
import { QueryBalancesDto } from '../dto/query-balances.dto';
import { LedgerService, LedgerStatement } from '../services/ledger.service';
import { LedgerAccountType, LedgerBalanceRow } from '../types/ledger.types';

const USER_ID = { name: 'userId', format: 'uuid' };

@ApiTags('Ledger')
@ApiBearerAuth(JWT_AUTH)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly userService: UserService,
  ) {}

  @ApiOperation({
    summary: 'Your balance and statement',
    description:
      'Signed-in sender or courier. A sender sees what the company owes them (cash collected on their parcels, less fees) or what they owe. A courier sees the cash they hold and have not handed in.',
  })
  @ApiResponse({ status: 200, type: LedgerStatementDto })
  @Roles(Role.SENDER, Role.DELIVERY_PERSONNEL, Role.ADMIN)
  @Get('me')
  mine(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ): Promise<LedgerStatement> {
    return this.ledgerService.statement(
      this.ledgerService.accountTypeFor(user),
      user,
      query,
    );
  }

  @ApiOperation({
    summary: 'What every merchant is owed',
    description: 'Admin only. Largest balance first.',
  })
  @ApiResponse({ status: 200, type: PaginatedLedgerBalancesDto })
  @Roles(Role.ADMIN)
  @Get('merchants')
  merchants(
    @Query() query: QueryBalancesDto,
  ): Promise<Paginated<LedgerBalanceRow>> {
    return this.ledgerService.balances(LedgerAccountType.MERCHANT, query);
  }

  @ApiOperation({
    summary: 'Cash every courier is holding',
    description: 'Admin only. Largest balance first.',
  })
  @ApiResponse({ status: 200, type: PaginatedLedgerBalancesDto })
  @Roles(Role.ADMIN)
  @Get('couriers')
  couriers(
    @Query() query: QueryBalancesDto,
  ): Promise<Paginated<LedgerBalanceRow>> {
    return this.ledgerService.balances(LedgerAccountType.COURIER, query);
  }

  @ApiOperation({ summary: "A merchant's statement", description: 'Admin only.' })
  @ApiParam(USER_ID)
  @ApiResponse({ status: 200, type: LedgerStatementDto })
  @Roles(Role.ADMIN)
  @Get('merchants/:userId')
  async merchant(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<LedgerStatement> {
    const user = await this.userService.findEntityByIdOrFail(userId);
    return this.ledgerService.statement(
      LedgerAccountType.MERCHANT,
      user,
      query,
    );
  }

  @ApiOperation({ summary: "A courier's statement", description: 'Admin only.' })
  @ApiParam(USER_ID)
  @ApiResponse({ status: 200, type: LedgerStatementDto })
  @Roles(Role.ADMIN)
  @Get('couriers/:userId')
  async courier(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<LedgerStatement> {
    const user = await this.userService.findEntityByIdOrFail(userId);
    return this.ledgerService.statement(LedgerAccountType.COURIER, user, query);
  }

  @ApiOperation({
    summary: 'Record cash a courier handed in',
    description:
      'Admin only. Lowers the cash the courier holds; refused above their balance.',
  })
  @ApiParam(USER_ID)
  @ApiResponse({ status: 201, type: LedgerStatementDto })
  @ApiResponse({
    status: 400,
    description: 'Not a courier, or more than they hold',
  })
  @Roles(Role.ADMIN)
  @Post('couriers/:userId/deposits')
  async deposit(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() payload: CourierDepositDto,
    @CurrentUser() admin: User,
  ): Promise<LedgerStatement> {
    const courier = await this.userService.findEntityByIdOrFail(userId);
    return this.ledgerService.recordDeposit(courier, payload, admin);
  }

  @ApiOperation({
    summary: 'Record a payout to a merchant',
    description:
      'Admin only. Records money already sent by bank or wallet; refused above what the merchant is owed.',
  })
  @ApiParam(USER_ID)
  @ApiResponse({ status: 201, type: LedgerStatementDto })
  @ApiResponse({ status: 400, description: 'More than the merchant is owed' })
  @Roles(Role.ADMIN)
  @Post('merchants/:userId/payouts')
  async payout(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() payload: MerchantPayoutDto,
    @CurrentUser() admin: User,
  ): Promise<LedgerStatement> {
    const merchant = await this.userService.findEntityByIdOrFail(userId);
    return this.ledgerService.recordPayout(merchant, payload, admin);
  }
}

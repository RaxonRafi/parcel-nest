import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../user/types/user.types';
import {
  CheckoutResponseDto,
  PaymentResponseDto,
} from '../dto/payment-response.dto';
import { Payment } from '../entities/payment.entity';
import {
  GatewayCallback,
  PaymentService,
} from '../services/payment.service';
import { CheckoutSession, PaymentState } from '../types/payment.types';

const TRACKING_ID = { name: 'trackingId', example: 'TRK-7K2M9QX4T1VB' };

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: "Pay a prepaid parcel's delivery fee online",
    description:
      'The sender. Opens an SSLCommerz session for the full fee and returns `gatewayUrl` — send the browser there. Afterwards the gateway returns the browser to `FRONTEND_URL/payments/result?status=paid|failed|cancelled|review&trackingId=…`. Cash-on-delivery parcels need no payment: their fee comes out of the cash.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 201, type: CheckoutResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Cash on delivery, already paid, or the parcel is closed',
  })
  @ApiResponse({ status: 403, description: 'Not your parcel' })
  @ApiResponse({ status: 502, description: 'The gateway refused the session' })
  @ApiResponse({ status: 503, description: 'Online payment is not configured' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER, Role.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('parcels/:trackingId/checkout')
  checkout(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<CheckoutSession> {
    return this.paymentService.checkout(trackingId, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Payment attempts for a parcel',
    description: 'The sender or an admin. Newest first.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: [PaymentResponseDto] })
  @UseGuards(JwtAuthGuard)
  @Get('parcels/:trackingId')
  list(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Payment[]> {
    return this.paymentService.listForParcel(trackingId, user);
  }

  // ── Gateway callbacks ─────────────────────────────────────────────────────
  // SSLCommerz posts a form to these from the payer's browser (success, fail,
  // cancel) and from its own servers (ipn). Nothing in the body is trusted
  // beyond which transaction it concerns.

  @ApiExcludeEndpoint()
  @Post('sslcommerz/success')
  async success(
    @Body() body: GatewayCallback,
    @Res() res: Response,
  ): Promise<void> {
    const { outcome, trackingId } = await this.paymentService.confirm(body);
    res.redirect(303, this.paymentService.resultUrl(outcome, trackingId));
  }

  @ApiExcludeEndpoint()
  @Post('sslcommerz/fail')
  async fail(
    @Body() body: GatewayCallback,
    @Res() res: Response,
  ): Promise<void> {
    const { outcome, trackingId } = await this.paymentService.abandon(
      body,
      PaymentState.FAILED,
    );
    res.redirect(303, this.paymentService.resultUrl(outcome, trackingId));
  }

  @ApiExcludeEndpoint()
  @Post('sslcommerz/cancel')
  async cancel(
    @Body() body: GatewayCallback,
    @Res() res: Response,
  ): Promise<void> {
    const { outcome, trackingId } = await this.paymentService.abandon(
      body,
      PaymentState.CANCELLED,
    );
    res.redirect(303, this.paymentService.resultUrl(outcome, trackingId));
  }

  /**
   * Server to server, and the one callback that arrives even when the payer
   * closes the tab before being redirected back.
   */
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Post('sslcommerz/ipn')
  async ipn(@Body() body: GatewayCallback): Promise<{ received: true }> {
    await this.paymentService.confirm(body);
    return { received: true };
  }
}

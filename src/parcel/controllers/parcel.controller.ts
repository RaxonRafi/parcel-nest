import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { MessageResponseDto } from '../../auth/dto/auth-response.dto';
import { BulkBookingDto } from '../dto/bulk-booking.dto';
import {
  FailedAttemptDto,
  RescheduleDeliveryDto,
} from '../dto/delivery-attempt.dto';
import { UpdateParcelDto } from '../dto/update-parcel.dto';
import { CsvFormatError, readBulkBookings } from '../utils/parcel-csv.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../user/types/user.types';
import { Paginated } from '../../common/types/paginated.type';
import { AssignDeliveryDto } from '../dto/assign-delivery.dto';
import { DeliveryProofDto } from '../dto/delivery-proof.dto';
import { QueryParcelsDto } from '../dto/query-parcels.dto';
import { FeeBreakdownDto, QuoteParcelDto } from '../dto/quote-parcel.dto';
import { CreateParcelDto } from '../dto/create-parcel.dto';
import {
  BulkBookingResponseDto,
  PaginatedParcelsDto,
  ParcelResponseDto,
  ReindexResponseDto,
} from '../dto/parcel-response.dto';
import { PublicParcelResponseDto } from '../dto/public-parcel-response.dto';
import { UpdateParcelStatusDto } from '../dto/update-parcel-status.dto';
import { Parcel } from '../entities/parcel.entity';
import { PublicParcel } from '../types/parcel.types';
import { FeeBreakdown } from '../utils/pricing.util';
import { ParcelService } from '../services/parcel.service';

/** Every route below takes the parcel's public `trackingId`, not its uuid. */
const TRACKING_ID = { name: 'trackingId', example: 'TRK-7K2M9QX4T1VB' };

/** Opened inline by a browser, saved under `filename` when downloaded. */
function pdfFile(buffer: Buffer, filename: string): StreamableFile {
  return new StreamableFile(buffer, {
    type: 'application/pdf',
    disposition: `inline; filename="${filename}"`,
    length: buffer.length,
  });
}

@ApiTags('Parcels')
@Controller('parcels')
export class ParcelController {
  constructor(private readonly parcelService: ParcelService) {}

  @ApiOperation({
    summary: 'Price a parcel before booking it',
    description:
      'Public. Returns the fee and how it is made up for a weight and a cash-on-delivery amount, using the same calculation as booking. Nothing is stored.',
  })
  @ApiResponse({ status: 201, type: FeeBreakdownDto })
  @Post('quote')
  quote(@Body() payload: QuoteParcelDto): FeeBreakdown {
    return this.parcelService.quote(payload);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Create a parcel',
    description:
      'Sender or admin. The receiver is resolved by id or by email. The response carries `feeBreakdown`. With `REQUIRE_VERIFIED_EMAIL=true` on the server, an account that has not confirmed its email is refused with `403`.',
  })
  @ApiResponse({ status: 201, type: ParcelResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Email address not confirmed (only when the server requires it)',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER, Role.ADMIN)
  @Post()
  createParcel(
    @CurrentUser() user: User,
    @Body() payload: CreateParcelDto,
  ): Promise<Parcel> {
    return this.parcelService.create(user, payload);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Book parcels from a CSV file',
    description:
      'Sender or admin. Every row is validated before anything is booked: a file with an invalid row is refused whole with `400` and the problems per line. Valid rows are then booked one by one, and a row that still fails (a receiver account that cannot receive, say) is reported without stopping the rest.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: BulkBookingDto })
  @ApiResponse({ status: 201, type: BulkBookingResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Not a CSV, unknown columns, too many rows, or rows that fail validation (`errors` lists them by line)',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER, Role.ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1024 * 1024, files: 1 },
    }),
  )
  @Post('bulk')
  async bulkCreate(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() defaults: BulkBookingDto,
  ): Promise<BulkBookingResponseDto> {
    if (!file) {
      throw new BadRequestException('Attach the booking file as "file"');
    }
    if (!/\.csv$/i.test(file.originalname) && !/csv|text\/plain/.test(file.mimetype)) {
      throw new BadRequestException('The booking file must be a CSV');
    }

    const { file: _file, ...pickupDefaults } = defaults;
    let parsed: Awaited<ReturnType<typeof readBulkBookings>>;
    try {
      parsed = await readBulkBookings(file.buffer.toString('utf8'), pickupDefaults);
    } catch (error) {
      if (error instanceof CsvFormatError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (parsed.errors.length) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} need fixing — nothing was booked`,
        errors: parsed.errors,
      });
    }

    return this.parcelService.bulkCreate(user, parsed.rows);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Change a booking before pickup',
    description:
      'The sender or an admin, while the parcel is still PENDING. Any booking field except the receiver account may change. Weight, cash, zones and tier re-price the parcel and the difference is charged or credited; a parcel paid online cannot change price.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Already picked up, blocked, nothing sent, an invalid pickup window, or a price change on a paid parcel',
  })
  @ApiResponse({ status: 403, description: 'Not your parcel' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER, Role.ADMIN)
  @Patch(':trackingId')
  updateParcel(
    @Param('trackingId') trackingId: string,
    @Body() payload: UpdateParcelDto,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.updateParcel(trackingId, payload, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Record a failed delivery attempt',
    description:
      'The assigned courier or an admin, from OUT_FOR_DELIVERY. Counts the attempt (MAX_DELIVERY_ATTEMPTS, 3 by default). From FAILED_ATTEMPT the parcel goes OUT_FOR_DELIVERY again — refused once the attempts are used up — or RETURNING, through the status route.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Not out for delivery, blocked, or an invalid reschedule date',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.DELIVERY_PERSONNEL)
  @Patch(':trackingId/failed-attempt')
  recordFailedAttempt(
    @Param('trackingId') trackingId: string,
    @Body() payload: FailedAttemptDto,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.recordFailedAttempt(trackingId, payload, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Pick the day for the next attempt',
    description:
      'The receiver, the sender or an admin, after a failed attempt. Moves the estimated delivery date to match.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Not in FAILED_ATTEMPT, no attempts left, or an invalid date',
  })
  @UseGuards(JwtAuthGuard)
  @Patch(':trackingId/reschedule')
  rescheduleDelivery(
    @Param('trackingId') trackingId: string,
    @Body() payload: RescheduleDeliveryDto,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.rescheduleDelivery(trackingId, payload, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Email the receiver a new delivery code',
    description:
      'The receiver (or an admin) while the parcel is OUT_FOR_DELIVERY. The previous code stops working.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @Post(':trackingId/delivery-code')
  reissueDeliveryCode(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<{ message: string }> {
    return this.parcelService.reissueDeliveryCode(trackingId, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Download the shipping label',
    description:
      'The sender, an admin or the assigned courier. A 4×6 inch PDF with a QR code that opens the tracking page.',
  })
  @ApiParam(TRACKING_ID)
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'The label as a PDF' })
  @UseGuards(JwtAuthGuard)
  @Get(':trackingId/label')
  async label(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<StreamableFile> {
    return pdfFile(
      await this.parcelService.labelPdf(trackingId, user),
      `label-${trackingId}.pdf`,
    );
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Download the invoice',
    description:
      'The sender or an admin. An A4 PDF with the fee breakdown and how it is settled.',
  })
  @ApiParam(TRACKING_ID)
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'The invoice as a PDF' })
  @UseGuards(JwtAuthGuard)
  @Get(':trackingId/invoice')
  async invoice(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<StreamableFile> {
    return pdfFile(
      await this.parcelService.invoicePdf(trackingId, user),
      `invoice-${trackingId}.pdf`,
    );
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Move a parcel to a new status',
    description:
      'Admins may set any status. Delivery personnel may only update parcels assigned to them, and only to PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, RETURNING or RETURNED_TO_SENDER. FAILED_ATTEMPT has its own route. Going OUT_FOR_DELIVERY emails the receiver a fresh delivery code. With REQUIRE_DELIVERY_OTP=true a courier cannot set DELIVERED here — it takes delivery proof with the code.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Parcel is blocked, the transition is not allowed, PICKED_UP was requested with no courier assigned, or DELIVERED was requested for a cash-on-delivery parcel whose cash is not recorded',
  })
  @ApiResponse({
    status: 403,
    description:
      'Courier is not assigned to this parcel, or status not theirs to set',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.DELIVERY_PERSONNEL)
  @Patch(':trackingId/status')
  updateStatus(
    @Param('trackingId') trackingId: string,
    @Body() payload: UpdateParcelStatusDto,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.updateStatus(trackingId, payload, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Cancel a parcel',
    description:
      'The sender — or an admin, for a parcel they booked themselves — and only while it is still PENDING. After pickup, and for anyone else’s parcel, an admin cancels it through the status route.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Parcel is blocked or has already been picked up',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER, Role.ADMIN)
  @Patch(':trackingId/cancel')
  cancelParcel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.cancelParcel(trackingId, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Confirm delivery',
    description:
      'Any signed-in account, for a parcel addressed to it. A cash-on-delivery parcel is refused until the courier has recorded the cash through delivery proof.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Parcel is blocked, or cash on delivery is not collected yet',
  })
  @ApiResponse({ status: 403, description: 'Parcel is not addressed to you' })
  @UseGuards(JwtAuthGuard)
  @Patch(':trackingId/confirm')
  confirmParcel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.confirmDelivery(trackingId, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Block a parcel', description: 'Admin only.' })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':trackingId/block')
  blockParcel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.blockParcel(trackingId, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Release a blocked parcel',
    description: 'Admin only. The parcel resumes from the status it was in.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({ status: 400, description: 'Parcel is not blocked' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':trackingId/unblock')
  unblockParcel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.unblockParcel(trackingId, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Parcels you sent',
    description:
      'Sender, or an admin for parcels they booked themselves. Like every list, rows carry no `statusLogs` — open one with the `details` route for its timeline.',
  })
  @ApiResponse({ status: 200, type: PaginatedParcelsDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER, Role.ADMIN)
  @Get('my-parcels')
  getMyParcels(
    @CurrentUser() user: User,
    @Query() query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.parcelService.getMyParcels(user, query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Parcels on their way to you',
    description:
      'Any signed-in account. A parcel can be addressed to a sender or courier account too, so this is scoped by who the receiver is, not by role.',
  })
  @ApiResponse({ status: 200, type: PaginatedParcelsDto })
  @UseGuards(JwtAuthGuard)
  @Get('incoming-parcels')
  getIncomingParcels(
    @CurrentUser() user: User,
    @Query() query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.parcelService.getIncomingParcels(user, query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Parcels already delivered to you',
    description: 'Any signed-in account, scoped to parcels addressed to it.',
  })
  @ApiResponse({ status: 200, type: PaginatedParcelsDto })
  @UseGuards(JwtAuthGuard)
  @Get('delivery-history')
  getDeliveryHistory(
    @CurrentUser() user: User,
    @Query() query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.parcelService.getDeliveryHistory(user, query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Assign a courier',
    description:
      'Admin only. The target must be an approved, active `DELIVERY_PERSONNEL`. Re-assigning records a handover.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Parcel is blocked/closed, or the user is not an approved courier',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':trackingId/assign')
  assignDeliveryPersonnel(
    @Param('trackingId') trackingId: string,
    @Body() payload: AssignDeliveryDto,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.assignDeliveryPersonnel(
      trackingId,
      payload.deliveryPersonnelId,
      user,
    );
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Remove the assigned courier',
    description: 'Admin only. Leaves the parcel status untouched.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({ status: 400, description: 'Parcel has no courier assigned' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':trackingId/unassign')
  unassignDeliveryPersonnel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.unassignDeliveryPersonnel(trackingId, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Parcels assigned to you',
    description:
      'Delivery personnel only. Excludes delivered and cancelled parcels — this is the active queue.',
  })
  @ApiResponse({ status: 200, type: PaginatedParcelsDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DELIVERY_PERSONNEL)
  @Get('assigned-parcels')
  getAssignedParcels(
    @CurrentUser() user: User,
    @Query() query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.parcelService.getAssignedParcels(user, query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Deliveries you completed',
    description: 'Delivery personnel only.',
  })
  @ApiResponse({ status: 200, type: PaginatedParcelsDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DELIVERY_PERSONNEL)
  @Get('completed-deliveries')
  getCompletedDeliveries(
    @CurrentUser() user: User,
    @Query() query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.parcelService.getCompletedDeliveries(user, query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'List every parcel', description: 'Admin only.' })
  @ApiResponse({ status: 200, type: PaginatedParcelsDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  getAllParcels(@Query() query: QueryParcelsDto): Promise<Paginated<Parcel>> {
    return this.parcelService.getAllParcels(query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Rebuild the assistant index from the database',
    description:
      'Admin only. Re-indexes every parcel with its sender, receiver and courier, so the assistant can show each one to its own parties, and drops vectors whose parcel no longer exists. Safe to repeat.',
  })
  @ApiResponse({ status: 201, type: ReindexResponseDto })
  @ApiResponse({ status: 503, description: 'Assistant is not configured' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Throttle({ ai: { limit: 20, ttl: 60_000 } })
  @Post('reindex')
  async reindexAll(): Promise<ReindexResponseDto> {
    const { indexed, removed } = await this.parcelService.reindexAll();
    return {
      message: `${indexed} parcels re-indexed${removed ? `, ${removed} stale removed` : ''}`,
      indexed,
      removed,
    };
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Submit proof of delivery',
    description:
      'Courier assigned to the parcel, or an admin. Records photos, who signed and any cash collected, and moves the parcel to DELIVERED.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Parcel cancelled, or cash on delivery not confirmed',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.DELIVERY_PERSONNEL)
  @Patch(':trackingId/delivery-proof')
  submitDeliveryProof(
    @Param('trackingId') trackingId: string,
    @Body() payload: DeliveryProofDto,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.submitDeliveryProof(trackingId, payload, user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Open one parcel in full',
    description:
      'An admin, or the parcel’s sender, receiver or assigned courier. The full record: contact details, full addresses, proof of delivery, `feeBreakdown` and the `statusLogs` timeline with who made each change.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({ status: 403, description: 'Not a party to this parcel' })
  @ApiResponse({ status: 404, description: 'No parcel with that tracking id' })
  @UseGuards(JwtAuthGuard)
  @Get(':trackingId/details')
  getParcelDetails(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.getDetails(trackingId, user);
  }

  @ApiOperation({
    summary: 'Track a parcel',
    description:
      'Public — no authentication required, so the response is trimmed and masked: status and timeline, the pickup and delivery *area* rather than the street address, and names as first name plus initial. No sender, receiver or courier records are attached.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: PublicParcelResponseDto })
  @ApiResponse({ status: 404, description: 'No parcel with that tracking id' })
  @Get(':trackingId')
  getParcelByTrackingId(
    @Param('trackingId') trackingId: string,
  ): Promise<PublicParcel> {
    return this.parcelService.getByTrackingId(trackingId);
  }
}

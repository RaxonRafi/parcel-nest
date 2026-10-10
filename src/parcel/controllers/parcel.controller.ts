import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { Throttle } from '@nestjs/throttler';
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
import { CreateParcelDto } from '../dto/create-parcel.dto';
import {
  PaginatedParcelsDto,
  ParcelResponseDto,
  ReindexResponseDto,
} from '../dto/parcel-response.dto';
import { PublicParcelResponseDto } from '../dto/public-parcel-response.dto';
import { UpdateParcelStatusDto } from '../dto/update-parcel-status.dto';
import { Parcel } from '../entities/parcel.entity';
import { PublicParcel } from '../types/parcel.types';
import { ParcelService } from '../services/parcel.service';

/** Every route below takes the parcel's public `trackingId`, not its uuid. */
const TRACKING_ID = { name: 'trackingId', example: 'TRK-7K2M9QX4T1VB' };

@ApiTags('Parcels')
@Controller('parcels')
export class ParcelController {
  constructor(private readonly parcelService: ParcelService) {}

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Create a parcel',
    description: 'Sender or admin. The receiver is resolved by id or by email.',
  })
  @ApiResponse({ status: 201, type: ParcelResponseDto })
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
    summary: 'Move a parcel to a new status',
    description:
      'Admins may set any status. Delivery personnel may only update parcels assigned to them, and only to PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY or DELIVERED.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Parcel is blocked, the transition is not allowed, or DELIVERED was requested for a cash-on-delivery parcel whose cash is not recorded',
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
      'Sender only, and only while the parcel is still PENDING. After pickup an admin cancels it through the status route.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Parcel is blocked or has already been picked up',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER)
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
  @ApiOperation({ summary: 'Parcels you sent', description: 'Sender only.' })
  @ApiResponse({ status: 200, type: PaginatedParcelsDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER)
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
      'Admin only. Re-indexes every parcel with its sender, receiver and courier, so the assistant can show each one to its own parties. Safe to repeat.',
  })
  @ApiResponse({ status: 201, type: ReindexResponseDto })
  @ApiResponse({ status: 503, description: 'Assistant is not configured' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Throttle({ ai: { limit: 20, ttl: 60_000 } })
  @Post('reindex')
  async reindexAll(): Promise<ReindexResponseDto> {
    const { indexed } = await this.parcelService.reindexAll();
    return { message: `${indexed} parcels re-indexed`, indexed };
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

  @ApiOperation({
    summary: 'Track a parcel',
    description:
      'Public — no authentication required, so the response is trimmed: status, route and timeline only, with no sender, receiver or courier records attached.',
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

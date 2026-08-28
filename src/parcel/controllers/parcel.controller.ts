import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../user/types/user.types';
import { AssignDeliveryDto } from '../dto/assign-delivery.dto';
import { CreateParcelDto } from '../dto/create-parcel.dto';
import { ParcelResponseDto } from '../dto/parcel-response.dto';
import { PublicParcelResponseDto } from '../dto/public-parcel-response.dto';
import { UpdateParcelStatusDto } from '../dto/update-parcel-status.dto';
import { Parcel } from '../entities/parcel.entity';
import { PublicParcel } from '../types/parcel.types';
import { ParcelService } from '../services/parcel.service';

/** Every route below takes the parcel's public `trackingId`, not its uuid. */
const TRACKING_ID = { name: 'trackingId', example: 'TRK-20260828-A1B2C3' };

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
  @ApiResponse({ status: 400, description: 'Parcel is blocked or cancelled' })
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
    description: 'Sender only, and only before the parcel has been dispatched.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
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
    description: 'Receiver only.',
  })
  @ApiParam(TRACKING_ID)
  @ApiResponse({ status: 200, type: ParcelResponseDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEIVER)
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
  @ApiOperation({ summary: 'Parcels you sent', description: 'Sender only.' })
  @ApiResponse({ status: 200, type: [ParcelResponseDto] })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER)
  @Get('my-parcels')
  getMyParcels(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getMyParcels(user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Parcels on their way to you',
    description: 'Receiver only.',
  })
  @ApiResponse({ status: 200, type: [ParcelResponseDto] })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEIVER)
  @Get('incoming-parcels')
  getIncomingParcels(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getIncomingParcels(user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Parcels already delivered to you',
    description: 'Receiver only.',
  })
  @ApiResponse({ status: 200, type: [ParcelResponseDto] })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEIVER)
  @Get('delivery-history')
  getDeliveryHistory(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getDeliveryHistory(user);
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
  @ApiResponse({ status: 200, type: [ParcelResponseDto] })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DELIVERY_PERSONNEL)
  @Get('assigned-parcels')
  getAssignedParcels(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getAssignedParcels(user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Deliveries you completed',
    description: 'Delivery personnel only.',
  })
  @ApiResponse({ status: 200, type: [ParcelResponseDto] })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DELIVERY_PERSONNEL)
  @Get('completed-deliveries')
  getCompletedDeliveries(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getCompletedDeliveries(user);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'List every parcel', description: 'Admin only.' })
  @ApiResponse({ status: 200, type: [ParcelResponseDto] })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  getAllParcels(): Promise<Parcel[]> {
    return this.parcelService.getAllParcels();
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

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../user/types/user.types';
import { CreateParcelDto } from '../dto/create-parcel.dto';
import { UpdateParcelStatusDto } from '../dto/update-parcel-status.dto';
import { Parcel } from '../entities/parcel.entity';
import { ParcelService } from '../services/parcel.service';

@Controller('parcels')
export class ParcelController {
  constructor(private readonly parcelService: ParcelService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER, Role.ADMIN)
  @Post()
  createParcel(
    @CurrentUser() user: User,
    @Body() payload: CreateParcelDto,
  ): Promise<Parcel> {
    return this.parcelService.create(user, payload);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':trackingId/status')
  updateStatus(
    @Param('trackingId') trackingId: string,
    @Body() payload: UpdateParcelStatusDto,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.updateStatus(trackingId, payload, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER)
  @Patch(':trackingId/cancel')
  cancelParcel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.cancelParcel(trackingId, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEIVER)
  @Patch(':trackingId/confirm')
  confirmParcel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.confirmDelivery(trackingId, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':trackingId/block')
  blockParcel(
    @Param('trackingId') trackingId: string,
    @CurrentUser() user: User,
  ): Promise<Parcel> {
    return this.parcelService.blockParcel(trackingId, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SENDER)
  @Get('my-parcels')
  getMyParcels(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getMyParcels(user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEIVER)
  @Get('incoming-parcels')
  getIncomingParcels(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getIncomingParcels(user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEIVER)
  @Get('delivery-history')
  getDeliveryHistory(@CurrentUser() user: User): Promise<Parcel[]> {
    return this.parcelService.getDeliveryHistory(user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  getAllParcels(): Promise<Parcel[]> {
    return this.parcelService.getAllParcels();
  }

  @Get(':trackingId')
  getParcelByTrackingId(
    @Param('trackingId') trackingId: string,
  ): Promise<Parcel> {
    return this.parcelService.getByTrackingId(trackingId);
  }
}

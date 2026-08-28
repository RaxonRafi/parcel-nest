import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignDeliveryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Id of an approved `DELIVERY_PERSONNEL` user. Pick one from `GET /api/users/delivery`.',
  })
  @IsUUID('4', { message: 'deliveryPersonnelId must be a uuid' })
  deliveryPersonnelId!: string;
}

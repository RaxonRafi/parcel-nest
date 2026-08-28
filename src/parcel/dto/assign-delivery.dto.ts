import { ApiProperty } from '@nestjs/swagger';

export class AssignDeliveryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Id of an approved `DELIVERY_PERSONNEL` user. Pick one from `GET /api/users/delivery`.',
  })
  deliveryPersonnelId!: string;
}

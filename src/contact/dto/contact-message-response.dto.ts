import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/paginated-response.dto';
import { CONTACT_TOPICS } from './create-contact-message.dto';

export class ContactMessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Zain Malik' })
  name!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: CONTACT_TOPICS })
  topic!: string;

  @ApiProperty({ nullable: true, example: 'TRK-7K2M9QX4T1VB' })
  trackingId!: string | null;

  @ApiProperty()
  message!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class PaginatedContactMessagesDto {
  @ApiProperty({ type: [ContactMessageResponseDto] })
  data!: ContactMessageResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

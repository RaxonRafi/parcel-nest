import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateParcelDto } from './create-parcel.dto';

/**
 * Everything about a booking that can change before pickup. The receiver's
 * identity is not among it: sending to someone else is a different parcel,
 * so that is a cancel and a new booking.
 */
export class UpdateParcelDto extends PartialType(
  OmitType(CreateParcelDto, ['receiverId', 'receiverEmail'] as const),
) {}

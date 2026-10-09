import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MessageResponseDto } from '../../auth/dto/auth-response.dto';
import { MessageResponse } from '../../auth/types/auth.types';
import { CreateContactMessageDto } from '../dto/create-contact-message.dto';
import { ContactService } from '../services/contact.service';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @ApiOperation({
    summary: 'Send a message to support',
    description:
      'Public — used by the contact form on the landing page. The message is emailed to the support inbox (`SUPPORT_EMAIL`).',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  // Public and it sends email, so it gets the tight credential-style limit.
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post()
  async submit(
    @Body() payload: CreateContactMessageDto,
  ): Promise<MessageResponse> {
    return this.contactService.submit(payload);
  }
}

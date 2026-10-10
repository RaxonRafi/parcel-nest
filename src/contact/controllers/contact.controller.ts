import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MessageResponseDto } from '../../auth/dto/auth-response.dto';
import { MessageResponse } from '../../auth/types/auth.types';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Paginated } from '../../common/types/paginated.type';
import { JWT_AUTH } from '../../config/swagger.config';
import { Role } from '../../user/types/user.types';
import { PaginatedContactMessagesDto } from '../dto/contact-message-response.dto';
import { CreateContactMessageDto } from '../dto/create-contact-message.dto';
import { ContactMessage } from '../entities/contact-message.entity';
import { ContactService } from '../services/contact.service';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @ApiOperation({
    summary: 'Send a message to support',
    description:
      'Public — used by the contact form on the landing page. The message is stored and emailed to the support inbox (`SUPPORT_EMAIL`) with the visitor as the reply-to address. Leave `website` empty: it is a trap for bots.',
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

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Read contact-form messages',
    description: 'Admin only. Newest first.',
  })
  @ApiResponse({ status: 200, type: PaginatedContactMessagesDto })
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('messages')
  list(@Query() query: PaginationQueryDto): Promise<Paginated<ContactMessage>> {
    return this.contactService.list(query);
  }
}

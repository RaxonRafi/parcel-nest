import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { MessageResponseDto } from '../../auth/dto/auth-response.dto';
import { MessageResponse } from '../../auth/types/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Paginated } from '../../common/types/paginated.type';
import { JWT_AUTH } from '../../config/swagger.config';
import { User } from '../../user/entities/user.entity';
import {
  PaginatedNotificationsDto,
  UnreadCountDto,
} from '../dto/notification-response.dto';
import { QueryNotificationsDto } from '../dto/query-notifications.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationService } from '../services/notification.service';

@ApiTags('Notifications')
@ApiBearerAuth(JWT_AUTH)
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @ApiOperation({
    summary: 'Your notifications, newest first',
    description:
      'Everything raised for you in the last 90 days, whether or not you were connected when it happened. Pass `unread=true` for only the ones not read yet.',
  })
  @ApiResponse({ status: 200, type: PaginatedNotificationsDto })
  @Get()
  list(
    @CurrentUser() user: User,
    @Query() query: QueryNotificationsDto,
  ): Promise<Paginated<Notification>> {
    return this.notificationService.list(user.id, query);
  }

  @ApiOperation({ summary: 'How many you have not read' })
  @ApiResponse({ status: 200, type: UnreadCountDto })
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: User): Promise<UnreadCountDto> {
    return { unread: await this.notificationService.unreadCount(user.id) };
  }

  @ApiOperation({ summary: 'Mark every notification read' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @Patch('read-all')
  async markAllRead(@CurrentUser() user: User): Promise<MessageResponse> {
    const marked = await this.notificationService.markAllRead(user.id);
    return {
      message: `${marked} notification${marked === 1 ? '' : 's'} marked read`,
    };
  }

  @ApiOperation({ summary: 'Mark one notification read' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 404, description: 'No such notification of yours' })
  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MessageResponse> {
    await this.notificationService.markRead(user.id, id);
    return { message: 'Notification marked read' };
  }
}

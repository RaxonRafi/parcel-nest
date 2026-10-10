import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../common/access-control.module';
import { ContactController } from './controllers/contact.controller';
import { ContactMessage } from './entities/contact-message.entity';
import { ContactService } from './services/contact.service';

/** MailModule is global, so MailService needs no import here. */
@Module({
  imports: [TypeOrmModule.forFeature([ContactMessage]), AccessControlModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}

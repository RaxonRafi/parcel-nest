import { Module } from '@nestjs/common';
import { ContactController } from './controllers/contact.controller';
import { ContactService } from './services/contact.service';

/** MailModule is global, so MailService needs no import here. */
@Module({
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}

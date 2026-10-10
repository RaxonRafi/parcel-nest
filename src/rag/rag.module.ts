import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessControlModule } from '../common/access-control.module';
import { MulterModule } from '@nestjs/platform-express';
import { RagController } from './controllers/rag.controller';
import { RagService } from './services/rag.service';
import { UPLOAD_DIR } from './rag.constants';

@Module({
  imports: [
    ConfigModule,
    AccessControlModule,
    MulterModule.register({ dest: UPLOAD_DIR }),
  ],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}

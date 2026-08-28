import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessControlModule } from '../common/access-control.module';
import { MulterModule } from '@nestjs/platform-express';
import { RagController } from './controllers/rag.controller';
import { RagService } from './services/rag.service';

@Module({
  imports: [
    ConfigModule,
    AccessControlModule,
    // /tmp is the only writable path on Vercel's serverless filesystem.
    MulterModule.register({ dest: '/tmp/uploads' }),
  ],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}

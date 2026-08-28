import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { RagController } from './controllers/rag.controller';
import { RagService } from './services/rag.service';

@Module({
  imports: [
    ConfigModule,
    // /tmp is the only writable path on Vercel's serverless filesystem.
    MulterModule.register({ dest: '/tmp/uploads' }),
  ],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}

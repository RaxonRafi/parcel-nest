import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

@Module({
  imports: [
    ConfigModule,
    MulterModule.register({ dest: './src/rag/uploads' }),
  ],
  providers: [RagService],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}

import { Global, Module } from '@nestjs/common';
import { BackgroundService } from './background.service';

/** Global, like mail: anything may need to push work off the request path. */
@Global()
@Module({
  providers: [BackgroundService],
  exports: [BackgroundService],
})
export class BackgroundModule {}

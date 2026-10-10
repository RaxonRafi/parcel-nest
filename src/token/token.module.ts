import { Module } from '@nestjs/common';
import { RefreshCookieService } from './services/refresh-cookie.service';
import { TokenService } from './services/token.service';

@Module({
  providers: [TokenService, RefreshCookieService],
  exports: [TokenService, RefreshCookieService],
})
export class TokenModule {}

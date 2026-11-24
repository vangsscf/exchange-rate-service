import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { JsonMessageFilter } from './common/json-message.filter';
import { CurrencyModule } from './currencies/currency.module';

@Module({
    imports: [ScheduleModule.forRoot(), AuthModule, CurrencyModule],
    providers: [{ provide: APP_FILTER, useClass: JsonMessageFilter }],
})
export class AppModule {}


import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrencyController } from './currency.controller';
import { CurrencyRepository } from './currency.repository';
import { CurrencyService } from './currency.service';
import { RatesService } from './rates.service';

@Module({
    imports: [AuthModule],
    controllers: [CurrencyController],
    providers: [CurrencyRepository, CurrencyService, RatesService],
})
export class CurrencyModule {}


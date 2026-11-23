import { HttpException, HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import { JsonMessageException } from '../common/json-message.filter';
import { CurrencyRepository } from './currency.repository';
import { Currency, CurrencyType } from './currency.types';
import { demoRates, isDemoMode } from './demo-rates';
import { RatesService } from './rates.service';

@Injectable()
export class CurrencyService implements OnModuleInit {
    constructor(
        private readonly repository: CurrencyRepository,
        private readonly rates: RatesService,
    ) {}

    async onModuleInit(): Promise<void> {
        const configuredSymbols = process.env.COINS?.split(',').filter(Boolean) ?? [];
        const seedRates = isDemoMode() ? demoRates : new Map(configuredSymbols.map(symbol => [symbol, '1']));
        const currencies = await this.repository.findAll();
        const existing = new Set(currencies.map(coin => coin.symbol));
        const seeds = [...seedRates].filter(([symbol]) => !existing.has(symbol)).map(([symbol, rate]) => ({
            symbol,
            type: CurrencyType.main,
            rate,
        }));

        await this.repository.saveAll(seeds);
        await this.rates.refresh();
    }

    async convert(from: string, to: string, amount = 1, decimalPlaces?: number) {
        const source = await this.requireCurrency(from);
        const target = await this.requireCurrency(to);
        const value = new BigNumber(source.rate ?? NaN)
            .dividedBy(target.rate ?? NaN)
            .multipliedBy(amount)
            .toFixed(decimalPlaces || 8);

        return { from, amount, to, value };
    }

    async add(coin: Currency) {
        const existing = await this.repository.find(coin.symbol);
        if (existing?.type === CurrencyType.main) {
            throw new HttpException({ response: `${coin.symbol} can't be altered!` }, HttpStatus.NOT_FOUND);
        }

        try {
            coin.rate = await this.rates.getRate(coin);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not resolve rate';
            throw new JsonMessageException(message, HttpStatus.BAD_REQUEST);
        }

        await this.repository.save(coin);
        return { message: `Asset ${coin.symbol} added with success!` };
    }

    async remove(symbol: string) {
        const coin = await this.requireCurrency(symbol);
        if (coin.type === CurrencyType.main) {
            throw new HttpException({ response: `Main coin ${symbol} can't be removed` }, HttpStatus.BAD_REQUEST);
        }

        await this.repository.remove(symbol);
        return { message: `Asset ${symbol} removed with success!` };
    }

    private async requireCurrency(symbol: string): Promise<Currency> {
        const coin = await this.repository.find(symbol);
        if (!coin) {
            throw new HttpException({ response: `${symbol} not found` }, HttpStatus.NOT_FOUND);
        }
        return coin;
    }
}


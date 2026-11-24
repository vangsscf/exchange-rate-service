import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { createClient } from 'redis';
import { Currency } from './currency.types';
import { isDemoMode } from './demo-rates';

@Injectable()
export class CurrencyRepository implements OnApplicationShutdown {
    private readonly key = isDemoMode() ? 'coins:demo' : 'coins';
    private readonly logger = new Logger(CurrencyRepository.name);
    private readonly client = createClient({ url: process.env.REDIS })
        .on('error', (error: Error) => this.logger.error(error.message));
    private connection?: Promise<unknown>;

    async onApplicationShutdown(): Promise<void> {
        if (this.client.isOpen) {
            await this.client.disconnect();
        }
    }

    async save(coin: Currency): Promise<void> {
        const client = await this.getClient();
        await client.hSet(this.key, coin.symbol, JSON.stringify(coin));
    }

    async saveAll(coins: Currency[]): Promise<void> {
        if (coins.length === 0) {
            return;
        }

        const client = await this.getClient();
        const fields = coins.map(coin => [coin.symbol, JSON.stringify(coin)] as [string, string]);
        await client.hSet(this.key, fields);
    }

    async remove(symbol: string): Promise<void> {
        const client = await this.getClient();
        await client.hDel(this.key, symbol);
    }

    async findAll(): Promise<Currency[]> {
        const client = await this.getClient();
        const values = await client.hVals(this.key);
        return values.map(value => JSON.parse(value) as Currency);
    }

    async find(symbol: string): Promise<Currency | null> {
        const client = await this.getClient();
        const value = await client.hGet(this.key, symbol);
        return value == null ? null : JSON.parse(value) as Currency;
    }

    private async getClient() {
        this.connection ??= this.client.connect().catch(error => {
            this.connection = undefined;
            throw error;
        });
        await this.connection;
        return this.client;
    }
}


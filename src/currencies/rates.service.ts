import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import { load } from 'cheerio';
import { CurrencyRepository } from './currency.repository';
import { Currency, CurrencyType } from './currency.types';

type CoinApiRate = { asset_id_quote: string; rate: number };
type MarketAsset = { symbol: string; id: number };
type MarketQuotes = Record<number, { quote?: { USD?: { price: number } } }>;

const requestTimeout = 10_000;

@Injectable()
export class RatesService {
    private readonly logger = new Logger(RatesService.name);
    private coinApiRates: CoinApiRate[] = [];
    private marketAssets: MarketAsset[] = [];

    constructor(private readonly repository: CurrencyRepository) {}

    @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
    async refresh(): Promise<void> {
        try {
            await this.loadProviderRates();
            const currencies = await this.repository.findAll();
            for (const coin of currencies) {
                if (coin.symbol !== 'USD') {
                    coin.rate = await this.getRate(coin);
                }
            }
            await this.repository.saveAll(currencies);
        } catch {
            this.logger.warn('Currency rate refresh failed');
        }
    }

    async getRate(coin: Currency): Promise<Currency['rate']> {
        const coinApiRate = this.coinApiRates.find(rate => rate.asset_id_quote === coin.symbol);
        if (coinApiRate?.rate) {
            return new BigNumber(1).dividedBy(coinApiRate.rate).toFixed(30);
        }

        const marketAsset = this.marketAssets.find(asset => asset.symbol === coin.symbol);
        if (marketAsset?.id) {
            const price = await this.getMarketPrice(marketAsset.id);
            if (price) {
                return new BigNumber(price).toFixed(30);
            }
        }

        if (coin.type === CurrencyType.fixed) {
            return coin.rate;
        }
        if (coin.type === CurrencyType.scrapper) {
            return this.scrapeRate(coin);
        }
        throw new Error('Invalid currency or type');
    }

    private async loadProviderRates(): Promise<void> {
        const coinApi = await axios.get<{ rates: CoinApiRate[] }>(
            'https://rest.coinapi.io/v1/exchangerate/USD',
            { headers: { 'X-CoinAPI-Key': process.env.COINAPIKEY }, timeout: requestTimeout },
        );
        this.coinApiRates = coinApi.data?.rates ?? [];

        try {
            const response = await axios.get<{ data: MarketAsset[] }>(
                'https://pro-api.coinmarketcap.com/v1/cryptocurrency/map',
                { headers: { 'X-CMC_PRO_API_KEY': process.env.MCAPIKEY }, timeout: requestTimeout },
            );
            if (response.data?.data) {
                this.marketAssets = response.data.data;
            }
        } catch {
            this.logger.warn('Could not refresh the CoinMarketCap symbol map');
        }
    }

    private async getMarketPrice(id: number): Promise<number | undefined> {
        try {
            const response = await axios.get<{ data: MarketQuotes }>(
                'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest',
                { params: { id }, headers: { 'X-CMC_PRO_API_KEY': process.env.MCAPIKEY }, timeout: requestTimeout },
            );
            return response.data?.data?.[id]?.quote?.USD?.price;
        } catch {
            throw new Error('get Cotation Error');
        }
    }

    private async scrapeRate(coin: Currency): Promise<string> {
        let referenceRate: string | number = 1;
        if (coin.scrpprRateAsset) {
            try {
                const reference = await this.repository.find(coin.scrpprRateAsset);
                if (!reference) {
                    throw new Error('Reference currency not found');
                }
                referenceRate = reference.rate ?? NaN;
            } catch {
                throw new Error('Invalid rate currency');
            }
        }

        if (!coin.scrpprUrl?.trim()) {
            throw new Error('Scrapper url need to be informed');
        }

        try {
            const { data } = await axios.get<string>(coin.scrpprUrl, { timeout: requestTimeout });
            if (!data || !coin.scrpprRateTag) {
                throw new Error('Missing scraper content or price selector');
            }

            const $ = load(data);
            const decimalSymbol = coin.scrpprDecimalSymbol ?? ',';
            const rate = this.parseAmount($(coin.scrpprRateTag).text(), decimalSymbol);
            const amount = coin.scrpprAmountTag
                ? this.parseAmount($(coin.scrpprAmountTag).text(), decimalSymbol)
                : '1';

            return new BigNumber(rate).dividedBy(amount).multipliedBy(referenceRate).toFixed(30);
        } catch {
            throw new Error('Scrapper Error');
        }
    }

    private parseAmount(text: string, decimalSymbol: string): string {
        const value = text.split(' ').find(item => item.includes('$'));
        if (!value) {
            throw new Error('Invalid scraper text');
        }

        if (decimalSymbol === ',') {
            return value.replace(/[^\d,]/g, '').replace(',', '.');
        }
        return value.replace(/[^\d.]|\.(?=.*\.)/g, '');
    }
}

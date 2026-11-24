import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import Joi from 'joi';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JoiValidationPipe } from '../common/joi-validation.pipe';
import { CurrencyService } from './currency.service';
import { Currency, CurrencyType } from './currency.types';

type ConversionQuery = { from: string; to: string; amount?: number; decimalPlaces?: number };

const conversionSchema = Joi.object<ConversionQuery>({
    from: Joi.string().required(),
    to: Joi.string().required(),
    amount: Joi.number(),
    decimalPlaces: Joi.number().integer().max(30),
}).required();

const addSchema = Joi.object<Currency>({
    symbol: Joi.string().required().alphanum().max(15),
    type: Joi.string().required().valid(CurrencyType.crypto, CurrencyType.fixed, CurrencyType.scrapper, CurrencyType.fiat),
    rate: Joi.number(),
    scrpprRateAsset: Joi.string(),
    scrpprUrl: Joi.string(),
    scrpprAmountTag: Joi.string(),
    scrpprRateTag: Joi.string(),
    scrpprDecimalSymbol: Joi.string().valid(',', '.'),
}).required();

@Controller()
export class CurrencyController {
    constructor(private readonly currencies: CurrencyService) {}

    @Get('conversion')
    convert(@Query(new JoiValidationPipe(conversionSchema)) query: ConversionQuery) {
        return this.currencies.convert(query.from, query.to, query.amount, query.decimalPlaces);
    }

    @Post('add')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    add(@Body(new JoiValidationPipe(addSchema)) body: Currency) {
        return this.currencies.add(body);
    }

    @Delete('remove/:asset')
    @UseGuards(JwtAuthGuard)
    remove(@Param('asset') symbol: string) {
        return this.currencies.remove(symbol);
    }
}


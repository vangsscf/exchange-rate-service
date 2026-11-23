export enum CurrencyType {
    main = 'main',
    scrapper = 'scrapper',
    fiat = 'fiat',
    crypto = 'crypto',
    fixed = 'fixed',
}

export type Currency = {
    symbol: string;
    type: CurrencyType;
    rate?: string | number;
    scrpprUrl?: string;
    scrpprAmountTag?: string;
    scrpprRateTag?: string;
    scrpprRateAsset?: string;
    scrpprDecimalSymbol?: ',' | '.';
};


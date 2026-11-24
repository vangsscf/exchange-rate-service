const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Test } = require('@nestjs/testing');
const { SchedulerRegistry } = require('@nestjs/schedule');
const axios = require('axios');
const { AppModule } = require('../build/app.module');
const { CurrencyRepository } = require('../build/currencies/currency.repository');

function setEnvironment(t, fixtures) {
    const original = Object.fromEntries(Object.keys(fixtures).map(key => [key, process.env[key]]));
    Object.assign(process.env, fixtures);
    t.after(() => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });
}

function createMemoryRepository() {
    const coins = new Map();
    const repository = {
        find: async symbol => structuredClone(coins.get(symbol) ?? null),
        findAll: async () => structuredClone([...coins.values()]),
        save: async coin => { coins.set(coin.symbol, structuredClone(coin)); },
        saveAll: async batch => {
            for (const coin of batch) {
                await repository.save(coin);
            }
        },
        remove: async symbol => { coins.delete(symbol); },
    };
    return { coins, repository };
}

async function startApi(t, repository) {
    const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(CurrencyRepository)
        .useValue(repository)
        .compile();
    const app = module.createNestApplication({ logger: false });
    app.set('query parser', 'extended');
    t.after(() => app.close());
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();
    const request = (route, options) => fetch(baseUrl + route, options);
    const post = (route, body, token) => request(route, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
    return { app, request, post };
}

test('Nest API preserves the exchange-rate contract', async (t) => {
    const fixtures = {
        DEMO_MODE: 'false',
        COINS: 'USD,EUR',
        LOGIN: 'test-admin',
        PASS: 'test-password',
        SECRET: 'test-secret',
    };
    setEnvironment(t, fixtures);
    const { coins, repository } = createMemoryRepository();

    let euroRate = 0.5;
    t.mock.method(axios, 'get', async (url) => {
        switch (url) {
            case 'https://rest.coinapi.io/v1/exchangerate/USD':
                return { data: { rates: [{ asset_id_quote: 'EUR', rate: euroRate }] } };
            case 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/map':
                return { data: { data: [{ symbol: 'DEMO', id: 123 }] } };
            case 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest':
                return { data: { data: { 123: { quote: { USD: { price: 4 } } } } } };
            case 'https://example.test/rates':
                return { data: '<div id="price">R$6,00</div><div id="amount">$2</div>' };
            default:
                throw new Error('Unexpected fixture URL');
        }
    });

    const { app, request, post } = await startApi(t, repository);

    await t.test('seeds and refreshes configured assets before serving conversions', async () => {
        const response = await request('/conversion?from=USD&to=EUR&amount=10&decimalPlaces=2');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { from: 'USD', to: 'EUR', amount: 10, value: '5.00' });
        const defaults = await request('/conversion?from=USD&to=EUR');
        assert.equal(defaults.status, 200);
        assert.deepEqual(await defaults.json(), { from: 'USD', to: 'EUR', amount: 1, value: '0.50000000' });

        const missing = await request('/conversion?from=USD&to=UNKNOWN');
        assert.equal(missing.status, 404);
        assert.deepEqual(await missing.json(), { response: 'UNKNOWN not found' });
        assert.equal((await request('/conversion?from=USD')).status, 400);
    });

    let token;
    await t.test('requires a Bearer JWT in the Authorization header', async () => {
        const denied = await post('/login', { login: fixtures.LOGIN, password: 'wrong' });
        assert.equal(denied.status, 401);
        assert.equal(await denied.json(), 'Unauthorized');
        const login = await post('/login', { login: fixtures.LOGIN, password: fixtures.PASS });
        assert.equal(login.status, 200);
        ({ token } = await login.json());
        assert.ok(token);

        const missing = await request('/refresh');
        assert.equal(missing.status, 401);
        assert.equal(await missing.json(), 'Unauthorized');
        const invalid = await request('/refresh', { headers: { Authorization: 'Bearer invalid' } });
        assert.equal(invalid.status, 400);
        assert.equal(await invalid.json(), 'Invalid or expired token');
        const raw = await request('/refresh', { headers: { Authorization: token } });
        assert.equal(raw.status, 401);
        const query = await request(`/refresh?Authorization=${encodeURIComponent(token)}`);
        assert.equal(query.status, 401);
        const refresh = await request('/refresh', { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(refresh.status, 200);
        assert.ok((await refresh.json()).token);
        const lowercase = await request('/refresh', { headers: { Authorization: `bearer ${token}` } });
        assert.equal(lowercase.status, 200);
    });

    await t.test('adds and removes custom assets and protects existing main assets', async () => {
        const customAsset = { symbol: 'CUSTOM', type: 'fixed', rate: 2.5 };
        const unauthorizedAdd = await post('/add', customAsset);
        assert.equal(unauthorizedAdd.status, 401);
        assert.equal(await unauthorizedAdd.json(), 'Unauthorized');
        const added = await post('/add', customAsset, token);
        assert.equal(added.status, 200);
        assert.deepEqual(await added.json(), { message: 'Asset CUSTOM added with success!' });
        assert.equal(coins.get('CUSTOM').rate, 2.5);

        const addProviderAsset = await post('/add', { symbol: 'DEMO', type: 'crypto' }, token);
        assert.equal(addProviderAsset.status, 200);
        assert.equal(coins.get('DEMO').rate, '4.000000000000000000000000000000');

        const scraped = await post('/add', {
            symbol: 'WEB',
            type: 'scrapper',
            scrpprUrl: 'https://example.test/rates',
            scrpprRateTag: '#price',
            scrpprAmountTag: '#amount',
            scrpprRateAsset: 'EUR',
        }, token);
        assert.equal(scraped.status, 200);
        assert.equal(coins.get('WEB').rate, '6.000000000000000000000000000000');

        const changed = await post('/add', { ...customAsset, symbol: 'USD' }, token);
        assert.equal(changed.status, 404);
        const main = await request('/remove/USD', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        assert.equal(main.status, 400);

        const unauthorizedRemove = await request('/remove/CUSTOM', { method: 'DELETE' });
        assert.equal(unauthorizedRemove.status, 401);
        assert.equal(await unauthorizedRemove.json(), 'Unauthorized');
        const deleteOptions = { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } };
        const removed = await request('/remove/CUSTOM', deleteOptions);
        assert.equal(removed.status, 200);
        assert.deepEqual(await removed.json(), { message: 'Asset CUSTOM removed with success!' });
        assert.equal(coins.has('CUSTOM'), false);
        const missing = await request('/remove/CUSTOM', deleteOptions);
        assert.equal(missing.status, 404);
        assert.deepEqual(await missing.json(), { response: 'CUSTOM not found' });
    });

    await t.test('runs the registered refresh with its injected repository', async () => {
        euroRate = 0.25;
        const jobs = app.get(SchedulerRegistry).getCronJobs();
        assert.equal(jobs.size, 1);
        const [job] = jobs.values();
        await job.fireOnTick();

        const response = await request('/conversion?from=USD&to=EUR');
        assert.equal((await response.json()).value, '0.25000000');
    });
});

test('demo mode uses fixed rates without making outbound requests', async (t) => {
    setEnvironment(t, {
        DEMO_MODE: 'true',
        COINS: 'CUSTOMSEED',
        COINAPIKEY: '',
        MCAPIKEY: '',
        LOGIN: 'test-admin',
        PASS: 'test-password',
        SECRET: 'test-secret',
    });

    const outbound = t.mock.method(axios, 'get', async () => {
        throw new Error('Unexpected outbound request in demo mode');
    });
    const { coins, repository } = createMemoryRepository();
    const { app, request, post } = await startApi(t, repository);
    const conversion = await request('/conversion?from=USD&to=BRL&amount=10&decimalPlaces=2');
    assert.equal(conversion.status, 200);
    assert.equal((await conversion.json()).value, '50.00');
    assert.deepEqual([...coins.keys()], ['USD', 'BRL', 'EUR', 'BTC', 'ETH']);

    const login = await post('/login', { login: 'test-admin', password: 'test-password' });
    const { token } = await login.json();
    const added = await post('/add', { symbol: 'CUSTOM', type: 'fixed', rate: 2.5 }, token);
    assert.equal(added.status, 200);
    assert.equal((await (await request('/conversion?from=CUSTOM&to=USD')).json()).value, '2.50000000');
    assert.equal((await post('/add', { symbol: 'INVALID', type: 'fixed', rate: 0 }, token)).status, 400);

    const scraped = await post('/add', {
        symbol: 'WEB',
        type: 'scrapper',
        scrpprUrl: 'https://example.test/rates',
        scrpprRateTag: '#price',
    }, token);
    assert.equal(scraped.status, 400);

    const [job] = app.get(SchedulerRegistry).getCronJobs().values();
    await job.fireOnTick();
    assert.equal(coins.get('BRL').rate, '0.20');
    assert.equal(outbound.mock.callCount(), 0);
});

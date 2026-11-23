// Illustrative USD rates per unit, chosen for predictable demo conversions.
export const demoRates: ReadonlyMap<string, string> = new Map([
    ['USD', '1'],
    ['BRL', '0.20'],
    ['EUR', '1.10'],
    ['BTC', '60000'],
    ['ETH', '3000'],
]);

export function isDemoMode(): boolean {
    return process.env.DEMO_MODE?.toLowerCase() === 'true';
}

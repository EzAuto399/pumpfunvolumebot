const { ProtectedVolumeBot } = require('./src/bot');
require('dotenv').config();

async function main() {
    const bot = new ProtectedVolumeBot();
    const tokenAddress = process.env.TOKEN_ADDRESS;

    console.log("Starting volume bot with configuration:");
    console.log(`Buy Amount: ${bot.config.buy_amount} SOL`);
    console.log(`Priority Fee: ${bot.config.priority_fee} SOL`);
    console.log(`Slippage Tolerance: ${bot.config.slippage_tolerance * 100}%`);
    console.log(`Buy -> Sell Delay: ${bot.config.buy_sell_delay} seconds`);

    console.log(`Delay: ${bot.config.transaction_delay} seconds`);
    console.log(`Cycles: ${bot.config.cycles}`);

    await bot.executeProtectedVolume();''
}

main().catch(console.error);

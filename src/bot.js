const web3 = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
require('dotenv').config();

class ProtectedVolumeBot {
    constructor() {
        // Validate essential environment variables
        if (!process.env.WALLET_PRIVATE_KEY) {
            throw new Error('Wallet private key not found in environment variables');
        }
        if (!process.env.TOKEN_ADDRESS) {
            throw new Error('TOKEN_ADDRESS is not defined in environment variables.');
        }

        this.tokenAddress = process.env.TOKEN_ADDRESS;
        this.config = this.loadConfig();

        // Validate configuration parameters
        this.validateConfig();

        // Standard RPC connection for general operations
        this.connection = new web3.Connection('https://api.mainnet-beta.solana.com', {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000,
        });

        // Initialize wallet
        try {
            this.wallet = web3.Keypair.fromSecretKey(
                Buffer.from(JSON.parse(process.env.WALLET_PRIVATE_KEY))
            );
            console.log('Wallet connected:', this.wallet.publicKey.toString());
        } catch (error) {
            throw new Error(`Wallet initialization failed: ${error.message}`);
        }

        // Initialize token decimals to null
        this.tokenDecimals = null;
    }

    /**
     * Load configuration from config.json or use default settings.
     */
    loadConfig() {
        const configPath = path.join(__dirname, 'config.json');
        try {
            if (!fs.existsSync(configPath)) {
                const defaultConfig = {
                    buy_amount: 0.0001, // SOL to spend on buy
                    priority_fee: 0.0001, // Increased from 0.00006
                    transaction_delay: 1.0, // Seconds between cycles
                    cycles: 1, // Number of buy-sell cycles
                    slippage_tolerance: 0.01, // 1% slippage tolerance
                    max_retries: 3, // Max retry attempts per cycle
                    minimum_balance: 0.05, // Minimum SOL balance to maintain
                };
                fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4));
                console.log('Default config.json created.');
                return defaultConfig;
            }
            const configData = fs.readFileSync(configPath, 'utf8');
            if (!configData) {
                throw new Error('Config file is empty');
            }
            console.log('Configuration loaded from config.json.');
            return JSON.parse(configData);
        } catch (error) {
            console.error(`Error loading config: ${error.message}`);
            console.log('Using default configuration.');
            return {
                buy_amount: 0.0001,
                priority_fee: 0.0001, // Increased from 0.00006
                transaction_delay: 1.0,
                cycles: 1,
                slippage_tolerance: 0.01,
                max_retries: 3,
                minimum_balance: 0.05,
            };
        }
    }

    /**
     * Validate configuration parameters to ensure they are within expected ranges.
     */
    validateConfig() {
        const {
            buy_amount,
            priority_fee,
            transaction_delay,
            cycles,
            slippage_tolerance,
            max_retries,
            minimum_balance,
        } = this.config;

        if (typeof buy_amount !== 'number' || buy_amount <= 0) {
            throw new Error('Invalid buy_amount in config.json. It must be a positive number.');
        }

        if (typeof priority_fee !== 'number' || priority_fee < 0) {
            throw new Error('Invalid priority_fee in config.json. It must be a non-negative number.');
        }

        if (
            typeof transaction_delay !== 'number' ||
            transaction_delay < 0
        ) {
            throw new Error(
                'Invalid transaction_delay in config.json. It must be a non-negative number.'
            );
        }

        if (typeof cycles !== 'number' || cycles <= 0) {
            throw new Error('Invalid cycles in config.json. It must be a positive number.');
        }

        if (
            typeof slippage_tolerance !== 'number' ||
            slippage_tolerance <= 0 ||
            slippage_tolerance >= 1
        ) {
            throw new Error(
                'Invalid slippage_tolerance in config.json. It must be a number between 0 and 1 (exclusive).'
            );
        }

        if (
            typeof max_retries !== 'number' ||
            max_retries < 0 ||
            !Number.isInteger(max_retries)
        ) {
            throw new Error(
                'Invalid max_retries in config.json. It must be a non-negative integer.'
            );
        }

        if (
            typeof minimum_balance !== 'number' ||
            minimum_balance < 0
        ) {
            throw new Error(
                'Invalid minimum_balance in config.json. It must be a non-negative number.'
            );
        }

        console.log('Configuration parameters validated successfully.');
    }

    /**
     * Fetch and cache the token decimals.
     */
    async getTokenDecimals() {
        if (this.tokenDecimals !== null) {
            return this.tokenDecimals; // Return cached value
        }
        try {
            const mintPublicKey = new web3.PublicKey(this.tokenAddress);
            const mintAccountInfo = await this.connection.getParsedAccountInfo(
                mintPublicKey
            );
            if (mintAccountInfo.value && mintAccountInfo.value.data) {
                const data = mintAccountInfo.value.data;
                if (
                    data.parsed &&
                    data.parsed.info &&
                    data.parsed.info.decimals !== undefined
                ) {
                    const decimals = data.parsed.info.decimals;
                    this.tokenDecimals = decimals; // Cache the decimals
                    console.log(`Token decimals fetched: ${decimals}`);
                    return decimals;
                } else {
                    throw new Error('Failed to parse token mint account info for decimals.');
                }
            } else {
                throw new Error('Failed to fetch token mint account info.');
            }
        } catch (error) {
            console.error('Error fetching token decimals:', error.message);
            throw error;
        }
    }

    /**
     * Check the balance of the specified token in tokens (float).
     */
    async getTokenBalance() {
        try {
            const tokenAccounts = await this.connection.getTokenAccountsByOwner(
                this.wallet.publicKey,
                {
                    mint: new web3.PublicKey(this.tokenAddress),
                }
            );

            if (tokenAccounts.value.length === 0) {
                console.warn('No token accounts found for the specified mint address.');
                return 0;
            }

            const tokenAccountInfo = await this.connection.getParsedAccountInfo(
                tokenAccounts.value[0].pubkey
            );
            if (!tokenAccountInfo.value) {
                console.warn('Token account information is unavailable.');
                return 0;
            }

            const tokenAmount =
                tokenAccountInfo.value.data.parsed.info.tokenAmount;
            const decimals = await this.getTokenDecimals();

            // Return the amount in tokens (float), not smallest unit
            return parseFloat(tokenAmount.amount) / Math.pow(10, decimals);
        } catch (error) {
            console.error('Error fetching token balance:', error.message);
            return 0;
        }
    }

    /**
     * Check the balance of the specified token in the smallest unit (BigInt).
     */
    async getTokenBalanceInSmallestUnit() {
        try {
            const tokenAccounts = await this.connection.getTokenAccountsByOwner(
                this.wallet.publicKey,
                {
                    mint: new web3.PublicKey(this.tokenAddress),
                }
            );

            if (tokenAccounts.value.length === 0) {
                console.warn('No token accounts found for the specified mint address.');
                return BigInt(0);
            }

            const tokenAccountInfo = await this.connection.getParsedAccountInfo(
                tokenAccounts.value[0].pubkey
            );
            if (!tokenAccountInfo.value) {
                console.warn('Token account information is unavailable.');
                return BigInt(0);
            }

            const tokenAmount =
                tokenAccountInfo.value.data.parsed.info.tokenAmount;

            // Return the amount in the smallest unit as BigInt
            return BigInt(tokenAmount.amount);
        } catch (error) {
            console.error('Error fetching token balance:', error.message);
            return BigInt(0);
        }
    }

    /**
     * Execute the protected volume operations: buy and sell.
     */
    async executeProtectedVolume() {
        const { transaction_delay, cycles, max_retries } = this.config;

        for (let cycle = 1; cycle <= cycles; cycle++) {
            console.log(`\n=== Starting Cycle ${cycle}/${cycles} ===`);
            let attempt = 0;
            let cycleSuccess = false;

            while (attempt < max_retries && !cycleSuccess) {
                attempt++;
                console.log(`\nCycle ${cycle}: Attempt ${attempt} of ${max_retries}`);

                try {
                    // Step 1: Execute Buy Transaction
                    const buySignature = await this.executeBuyTransaction();
                    if (!buySignature) {
                        throw new Error('Buy transaction failed without a signature.');
                    }

                    // Step 2: Confirm Buy Transaction
                    const buyConfirmed = await this.confirmTransaction(
                        buySignature,
                        'Buy'
                    );
                    if (!buyConfirmed) {
                        throw new Error(`Buy transaction ${buySignature} was not successful.`);
                    }

                    // Step 3: Fetch Token Balance
                    const tokenAmount = await this.getTokenBalance();
                    console.log(`Token balance after buy: ${tokenAmount}`);

                    if (tokenAmount === 0) {
                        console.warn('Token balance is zero after buy. Skipping sell.');
                        cycleSuccess = true; // Consider as successful since there's nothing to sell
                        break;
                    }

                    // Step 4: Execute Sell Transaction
                    const sellSignature = await this.executeSellTransaction(tokenAmount);
                    if (!sellSignature) {
                        throw new Error('Sell transaction failed without a signature.');
                    }

                    // Step 5: Confirm Sell Transaction
                    const sellConfirmed = await this.confirmTransaction(
                        sellSignature,
                        'Sell'
                    );
                    if (!sellConfirmed) {
                        throw new Error(
                            `Sell transaction ${sellSignature} was not successful.`
                        );
                    }

                    // Cycle completed successfully
                    console.log(`Cycle ${cycle} completed successfully.`);
                    cycleSuccess = true;
                } catch (error) {
                    console.error(
                        `Cycle ${cycle}, Attempt ${attempt} failed: ${error.message}`
                    );
                    if (attempt < max_retries) {
                        const backoffTime = this.getExponentialBackoffTime(attempt);
                        console.log(`Retrying in ${backoffTime / 1000} seconds...`);
                        await this.delay(backoffTime);
                    } else {
                        console.error(
                            `Cycle ${cycle} failed after ${max_retries} attempts.`
                        );
                    }
                }
            }

            if (!cycleSuccess) {
                console.error(
                    `Cycle ${cycle} could not be completed successfully after ${max_retries} attempts.`
                );
            }

            // Wait for the configured delay before the next cycle, if not the last cycle
            if (cycle < cycles && cycleSuccess) {
                console.log(
                    `Waiting for ${transaction_delay} seconds before the next cycle.`
                );
                await this.delay(transaction_delay * 1000);
            }
        }

        console.log('\nAll cycles have been executed.');
    }

    /**
     * Calculate exponential backoff time based on attempt number.
     */
    getExponentialBackoffTime(attempt) {
        const baseDelay = 2000; // 2 seconds
        return baseDelay * Math.pow(2, attempt - 1);
    }

    /**
     * Utility function to delay execution for a specified time.
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Execute a buy transaction.
     */
    async executeBuyTransaction() {
        try {
            const buyTx = await this.createBuyTransaction(
                this.tokenAddress,
                this.config.buy_amount
            );
            buyTx.sign([this.wallet]);
            const buyRawTx = buyTx.serialize();
            const buySignature = await this.connection.sendRawTransaction(
                buyRawTx,
                {
                    skipPreflight: true,
                    maxRetries: this.config.max_retries,
                }
            );
            console.log(`Buy transaction submitted: ${buySignature}`);
            return buySignature;
        } catch (error) {
            console.error('Error executing buy transaction:', error.message);
            return null;
        }
    }

    /**
     * Execute a sell transaction.
     */
    async executeSellTransaction(amount) {
        try {
            const sellTx = await this.createSellTransaction(
                this.tokenAddress,
                amount
            );
            sellTx.sign([this.wallet]);
            const sellRawTx = sellTx.serialize();
            const sellSignature = await this.connection.sendRawTransaction(
                sellRawTx,
                {
                    skipPreflight: true,
                    maxRetries: this.config.max_retries,
                }
            );
            console.log(`Sell transaction submitted: ${sellSignature}`);
            return sellSignature;
        } catch (error) {
            console.error('Error executing sell transaction:', error.message);
            return null;
        }
    }

    /**
     * Confirm a transaction and check its success.
     */
    async confirmTransaction(signature, type) {
        try {
            const confirmation = await this.connection.confirmTransaction(
                signature,
                'confirmed'
            );
            console.log(`${type} transaction confirmation:`, confirmation);

            const success = await this.checkTransactionSuccess(signature);
            return success;
        } catch (error) {
            console.error(
                `Error confirming ${type} transaction ${signature}:`,
                error.message
            );
            return false;
        }
    }

    /**
     * Check if a transaction was successful.
     */
    async checkTransactionSuccess(signature) {
        try {
            const txInfo = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });
            if (txInfo && txInfo.meta) {
                if (txInfo.meta.err === null) {
                    console.log(`Transaction ${signature} was successful.`);
                    return true;
                } else {
                    console.error(`Transaction ${signature} failed with error:`, txInfo.meta.err);

                    // Provide more detailed guidance for known errors
                    if (txInfo.meta.err.InstructionError && Array.isArray(txInfo.meta.err.InstructionError)) {
                        const [instructionIndex, errorType] = txInfo.meta.err.InstructionError;
                        console.error(`InstructionError at instruction ${instructionIndex}: ${errorType}`);

                        if (errorType === 'ProgramFailedToComplete') {
                            console.error(
                                'The transaction failed to complete. Possible reasons:\n' +
                                '- You might be trying to sell more tokens than you have.\n' +
                                '- The pool may not have enough liquidity.\n' +
                                '- The parameters (like slippage or denominatedInSol) might be incorrect.\n' +
                                'Try adjusting the sell amount, slippage tolerance, or waiting before retrying.'
                            );
                        }
                    }

                    return false;
                }
            } else {
                console.error(`Transaction ${signature} not found or not confirmed yet.`);
                return false;
            }
        } catch (error) {
            console.error(`Error fetching transaction info for ${signature}:`, error.message);
            return false;
        }
    }


    /**
     * Create a buy transaction by interacting with the pump.fun API.
     */
    async createBuyTransaction(tokenAddress, amount) {
        try {
            const response = await fetch(
                'https://pumpportal.fun/api/trade-local',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        publicKey: this.wallet.publicKey.toString(),
                        action: 'buy',
                        mint: tokenAddress,
                        amount: amount, // Amount in SOL
                        denominatedInSol: 'true',
                        slippage: (this.config.slippage_tolerance * 100).toString(),
                        priorityFee: this.config.priority_fee.toString(),
                        pool: 'pump',
                    }),
                }
            );

            if (response.status === 200) {
                const data = await response.arrayBuffer();
                return web3.VersionedTransaction.deserialize(new Uint8Array(data));
            }

            // Capture and log the response body for debugging
            const errorData = await response.text();
            console.error(
                `Failed to create buy transaction. Status code: ${response.status}. Response: ${errorData}`
            );
            throw new Error(
                `Failed to create buy transaction. Status code: ${response.status}. Response: ${errorData}`
            );
        } catch (error) {
            console.error('Error creating buy transaction:', error.message);
            throw error;
        }
    }

    /**
     * Create a sell transaction by interacting with the pump.fun API (Modified according to instructions).
     */
    async createSellTransaction(tokenAddress, amount) {
        const decimals = await this.getTokenDecimals();
        // Only sell the approximate tokens we just bought, based on the initial buy_amount in SOL
        const buyAmountInTokens = this.config.buy_amount; // This is in SOL

        // Calculate approximate tokens corresponding to buy_amount in terms of decimals
        const smallestUnitAmount = BigInt(
            Math.round(buyAmountInTokens * Math.pow(10, decimals))
        );

        const requestBody = {
            publicKey: this.wallet.publicKey.toString(),
            action: 'sell',
            mint: tokenAddress,
            amount: this.config.buy_amount.toString(), // Match the buy amount
            denominatedInSol: 'true',
            slippage: '1.5', // Increase slippage tolerance
            priorityFee: this.config.priority_fee.toString(),
            pool: 'pump'
        };

        console.log('Sell Transaction Request Body:', requestBody);

        try {
            const response = await fetch(
                'https://pumpportal.fun/api/trade-local',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody),
                }
            );

            if (response.status === 200) {
                const data = await response.arrayBuffer();
                return web3.VersionedTransaction.deserialize(new Uint8Array(data));
            }

            // Capture and log the response body for debugging
            const errorData = await response.text();
            console.error(
                `Failed to create sell transaction. Status code: ${response.status}. Response: ${errorData}`
            );
            throw new Error(
                `Failed to create sell transaction. Status code: ${response.status}. Response: ${errorData}`
            );
        } catch (error) {
            console.error('Error creating sell transaction:', error.message);
            throw error;
        }
    }
}

module.exports = { ProtectedVolumeBot };

#!/usr/bin/env node

const program = require('commander');
const fs = require('fs');
const bip39 = require('bip39');
const HDKey = require('hdkey');

const walletName = 'wallet.json';
const wallet = loadWallet() || initializeWallet();

function loadWallet() {
    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
    }
}

function initializeWallet() {

    if (fs.existsSync(walletName)) {
        return 'Wallet already initialized';
    }

    const mnemonic = bip39.generateMnemonic();
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    const wallet = {
        seed: {
            mnemonic: mnemonic,
            hdkey: hdkey.toJSON(),
        }
    }
    const walletJson = JSON.stringify(wallet, null, 4);

    fs.writeFileSync(walletName, walletJson);
    return wallet;
}

program
    .version('1.0.0')
    .description('Keychain CLI tool');

program
    .command('show')
    .alias('s')
    .description('Show wallet')
    .action(() => {
        console.log(JSON.stringify(wallet, null, 4));
    });

program.parse(process.argv);


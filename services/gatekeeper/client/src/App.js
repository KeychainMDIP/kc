import { Buffer } from 'buffer';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as cipher from '@mdip/cipher/web';
import * as keymaster from '@mdip/keymaster/lib';
import * as db_wallet from "@mdip/keymaster/db/web";
import KeymasterUI from './KeymasterUI.js';
import './App.css';

global.Buffer = Buffer;

function App() {
    keymaster.start(gatekeeper, db_wallet, cipher);

    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster Browser Wallet Demo'} />
    );
}

export default App;

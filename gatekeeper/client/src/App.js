import { Buffer } from 'buffer';
import * as gatekeeper from '@macterra/gatekeeper/sdk';
import * as cipher from '@macterra/cipher/web';
import * as keymaster from '@macterra/keymaster/lib';
import * as db_wallet from "@macterra/keymaster/db/web";
import KeymasterUI from './KeymasterUI.js';
import './App.css';

global.Buffer = Buffer;

function App() {
    keymaster.start(gatekeeper, db_wallet, cipher);

    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster Wallet Demo'} />
    );
}

export default App;

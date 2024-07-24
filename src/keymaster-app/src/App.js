import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster-lib.js';
import * as db_wallet from "./db-wallet-web.js";
import KeymasterUI from './KeymasterUI.js';
import './App.css';

function App() {
    keymaster.start(gatekeeper, db_wallet);

    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster Wallet Demo'} />
    );
}

export default App;

import * as gatekeeper from './gatekeeper-web.js';
import * as keymaster from './keymaster-web.js';
import * as db_wallet from "./db-wallet-web.js";
import * as cipher from './cipher-web.js';
import KeymasterUI from './KeymasterUI.js';
import './App.css';

keymaster.start(gatekeeper, cipher, db_wallet);

function App() {
    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster Wallet Demo'} />
    );
}

export default App;

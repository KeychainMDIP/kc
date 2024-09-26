import * as keymaster from '@mdip/keymaster/sdk';
import KeymasterUI from './KeymasterUI.js';
import './App.css';

function App() {
    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster Server Wallet Demo'} />
    );
}

export default App;

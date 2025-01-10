import KeymasterClient from '@mdip/keymaster/client';
import KeymasterUI from './KeymasterUI.js';
import './App.css';

function App() {
    const keymaster = new KeymasterClient();
    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster Server Wallet Demo'} />
    );
}

export default App;

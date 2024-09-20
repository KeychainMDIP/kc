import * as keymaster from '@macterra/keymaster/sdk';
import KeymasterUI from './KeymasterUI.js';
import './App.css';

function App() {
    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster API Demo'} />
    );
}

export default App;

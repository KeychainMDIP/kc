import * as keymaster from './keymaster-sdk.js';
import KeymasterUI from './KeymasterUI.js';
import './App.css';

function App() {
    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster API Demo'} />
    );
}

export default App;

import * as keymaster from './keymaster-lib.js';
import KeymasterUI from './KeymasterUI.js';
import './App.css';

function App() {
    return (
        <KeymasterUI keymaster={keymaster} />
    );
}

export default App;

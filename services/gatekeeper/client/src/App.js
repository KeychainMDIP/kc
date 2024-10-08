import { Buffer } from 'buffer';
import { useSearchParams } from 'react-router-dom';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as cipher from '@mdip/cipher/web';
import * as keymaster from '@mdip/keymaster/lib';
import * as wallet from "@mdip/keymaster/db/web";
import KeymasterUI from './KeymasterUI.js';
import './App.css';

global.Buffer = Buffer;

function App() {
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');

    keymaster.start({ gatekeeper, wallet, cipher });

    return (
        <KeymasterUI keymaster={keymaster} title={'Keymaster Browser Wallet Demo'} challengeDID={challengeDID} />
    );
}

export default App;

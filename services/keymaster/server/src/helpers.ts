import type Keymaster from '@mdip/keymaster';
import type { WalletFile } from '@mdip/keymaster/types';

interface NewWalletBody {
    mnemonic?: string;
    overwrite?: boolean;
}

export function createWalletFromBody(
    keymaster: Pick<Keymaster, 'newWallet'>,
    body?: NewWalletBody | null
): Promise<WalletFile> {
    return keymaster.newWallet(body?.mnemonic, body?.overwrite);
}

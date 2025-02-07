import React, { ReactNode } from 'react';
import { WalletProvider } from "./WalletProvider";
import { CredentialsProvider } from "./CredentialsProvider";
import { AuthProvider } from "./AuthContext";
import { MessageProvider } from "./MessageContext";
import { UIProvider } from "./UIContext";

function ContextProviders({ children, isBrowser }: { children: ReactNode, isBrowser: boolean }) {
    return (
        <WalletProvider isBrowser={isBrowser}>
            <CredentialsProvider>
                <AuthProvider>
                    <MessageProvider>
                        <UIProvider isBrowser={isBrowser}>
                            {children}
                        </UIProvider>
                    </MessageProvider>
                </AuthProvider>
            </CredentialsProvider>
        </WalletProvider>
    );
}

export default ContextProviders;
import React, { ReactNode } from 'react';
import { WalletProvider, openJSONViewerOptions } from "./WalletProvider";
import { CredentialsProvider } from "./CredentialsProvider";
import { AuthProvider } from "./AuthContext";
import { MessageProvider } from "./MessageContext";
import { UIProvider } from "./UIContext";

function ContextProviders(
    {
        children,
        isBrowser,
        pendingAuth,
        jsonViewerOptions,
        requestRefresh
    }: {
        children: ReactNode,
        isBrowser: boolean,
        pendingAuth?: string,
        jsonViewerOptions?: openJSONViewerOptions,
        requestRefresh?: number
    }) {

    return (
        <WalletProvider isBrowser={isBrowser}>
            <CredentialsProvider>
                <AuthProvider>
                    <MessageProvider>
                        <UIProvider pendingAuth={pendingAuth} jsonViewerOptions={jsonViewerOptions} requestRefresh={requestRefresh} >
                            {children}
                        </UIProvider>
                    </MessageProvider>
                </AuthProvider>
            </CredentialsProvider>
        </WalletProvider>
    );
}

export default ContextProviders;
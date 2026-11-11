import { ReactNode } from "react";
import { UIProvider } from "./UIProvider";
import { WalletProvider } from "./WalletProvider";
import { VariablesProvider } from "./VariablesProvider";
import { SafeAreaProvider } from "./SafeAreaContext";
import { SnackbarProvider } from "./SnackbarProvider";

export function ContextProviders(
    {
        children
    }: {
        children: ReactNode
    }) {
    return (
        <UIProvider>
            <SafeAreaProvider>
                <SnackbarProvider>
                    <WalletProvider>
                        <VariablesProvider>
                            {children}
                        </VariablesProvider>
                    </WalletProvider>
                </SnackbarProvider>
            </SafeAreaProvider>
        </UIProvider>
    );
}

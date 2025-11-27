import React, { createContext, ReactNode, useContext, useState } from "react";
import { useVariablesContext } from "./VariablesProvider";

interface AuthContextValue {
    authDID: string;
    setAuthDID: (value: string) => Promise<void>;
    callback: string;
    setCallback: (value: string) => Promise<void>;
    response: string;
    setResponse: (value: string) => Promise<void>;
    disableSendResponse: boolean;
    setDisableSendResponse: (value: boolean) => Promise<void>;
    challenge: string;
    setChallenge: (value: string) => Promise<void>;
    refreshAuthStored: (state: Record<string, any>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [authDID, setAuthDIDState] = useState<string>("");
    const [callback, setCallbackState] = useState<string>("");
    const [challenge, setChallengeState] = useState<string>("");
    const [response, setResponseState] = useState<string>("");
    const [disableSendResponse, setDisableSendResponseState] = useState<boolean>(true);
    const { storeState } = useVariablesContext();

    async function setCallback(value: string) {
        setCallbackState(value);
        await storeState("callback", value);
    }

    async function setResponse(value: string) {
        setResponseState(value);
        await storeState("response", value);
    }

    async function setDisableSendResponse(value: boolean) {
        setDisableSendResponseState(value);
        await storeState("disableSendResponse", value);
    }

    async function setAuthDID(value: string) {
        setAuthDIDState(value);
        await storeState("authDID", value);
    }

    async function setChallenge(value: string) {
        setChallengeState(value);
        await storeState("challenge", value);
    }

    async function refreshAuthStored(state: Record<string, any>) {
        if (state.challenge) {
            setChallengeState(state.challenge);
        }

        if (state.authDID) {
            setAuthDIDState(state.authDID);
        }

        if (state.callback) {
            setCallbackState(state.callback);
        }

        if (state.response) {
            setResponseState(state.response);
        }

        if (typeof state.disableSendResponse !== "undefined") {
            setDisableSendResponseState(state.disableSendResponse);
        }
    }

    const value: AuthContextValue = {
        authDID,
        setAuthDID,
        callback,
        setCallback,
        response,
        setResponse,
        disableSendResponse,
        setDisableSendResponse,
        challenge,
        setChallenge,
        refreshAuthStored,
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuthContext() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuthContext must be used within AuthProvider');
    }
    return ctx;
}

import React, { createContext, ReactNode, useContext, useState } from "react";
import { useWalletContext } from "./WalletProvider";

interface MessageContextValue {
    messageRegistry: string;
    setMessageRegistry: (value: string) => Promise<void>;
    messageDID: string;
    setMessageDID: (value: string) => Promise<void>;
    messageRecipient: string;
    setMessageRecipient: (value: string) => Promise<void>;
    sendMessage: string;
    setSendMessage: (value: string) => Promise<void>;
    receiveMessage: string;
    setReceiveMessage: (value: string) => Promise<void>;
    encryptedDID: string;
    setEncryptedDID: (value: string) => Promise<void>;
    refreshMessageStored: (state: any) => Promise<void>;
}

const MessageContext = createContext<MessageContextValue | null>(null);

export function MessageProvider({ children }: { children: ReactNode }) {
    const [messageRegistry, setMessageRegistryState] = useState<string>("hyperswarm");
    const [messageDID, setMessageDIDState] = useState<string>("");
    const [messageRecipient, setMessageRecipientState] = useState<string>("");
    const [sendMessage, setSendMessageState] = useState<string>("");
    const [receiveMessage, setReceiveMessageState] = useState<string>("");
    const [encryptedDID, setEncryptedDIDState] = useState<string>("");

    const {
        storeState,
    } = useWalletContext();

    async function setMessageRegistry(value: string) {
        setMessageRegistryState(value);
        await storeState("messageRegistry", value);
    }

    async function setMessageDID(value: string) {
        setMessageDIDState(value);
        await storeState("messageDID", value);
    }

    async function setMessageRecipient(value: string) {
        setMessageRecipientState(value);
        await storeState("messageRecipient", value);
    }

    async function setSendMessage(value: string) {
        setSendMessageState(value);
        await storeState("sendMessage", value);
    }

    async function setReceiveMessage(value: string) {
        setReceiveMessageState(value);
        await storeState("receiveMessage", value);
    }

    async function setEncryptedDID(value: string) {
        setEncryptedDIDState(value);
        await storeState("encryptedDID", value);
    }

    async function refreshMessageStored(state: any) {
        if (state.messageRegistry) {
            setMessageRegistryState(state.messageRegistry);
        }
        
        if (state.messageDID) {
            setMessageDIDState(state.messageDID);
        }

        if (state.messageRecipient) {
            setMessageRecipientState(state.messageRecipient);
        }

        if (state.sendMessage) {
            setSendMessageState(state.sendMessage);
        }

        if (state.receiveMessage) {
            setReceiveMessageState(state.receiveMessage);
        }

        if (state.encryptedDID) {
            setEncryptedDIDState(state.encryptedDID);
        }
    }

    const value: MessageContextValue = {
        messageRegistry,
        setMessageRegistry,
        messageDID,
        setMessageDID,
        messageRecipient,
        setMessageRecipient,
        sendMessage,
        setSendMessage,
        receiveMessage,
        setReceiveMessage,
        encryptedDID,
        setEncryptedDID,
        refreshMessageStored,
    }

    return (
        <MessageContext.Provider value={value}>
            {children}
        </MessageContext.Provider>
    );
}

export function useMessageContext() {
    const ctx = useContext(MessageContext);
    if (!ctx) {
        throw new Error('useMessageContext must be used within MessageProvider');
    }
    return ctx;
}

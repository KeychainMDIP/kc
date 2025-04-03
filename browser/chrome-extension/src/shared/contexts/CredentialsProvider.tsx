import React, { createContext, Dispatch, ReactNode, SetStateAction, useContext, useState } from "react";
import { useWalletContext } from "./WalletProvider";

interface CredentialsContextValue {
    heldDID: string;
    setHeldDID: (value: string) => Promise<void>;
    heldList: string[];
    setHeldList: Dispatch<SetStateAction<string[]>>;
    credentialDID: string;
    setCredentialDID: Dispatch<SetStateAction<string>>;
    credentialSubject: string;
    setCredentialSubject: Dispatch<SetStateAction<string>>;
    credentialSchema: string;
    setCredentialSchema: Dispatch<SetStateAction<string>>;
    credentialString: string;
    setCredentialString: Dispatch<SetStateAction<string>>;
    schemaList: string[];
    setSchemaList: Dispatch<SetStateAction<string[]>>;
    groupList: string[];
    setGroupList: Dispatch<SetStateAction<string[]>>;
    imageList: string[];
    setImageList: Dispatch<SetStateAction<string[]>>;
    issuedList: string[];
    setIssuedList: Dispatch<SetStateAction<string[]>>;
    issuedString: string;
    setIssuedString: Dispatch<SetStateAction<string>>;
    issuedStringOriginal: string;
    setIssuedStringOriginal: Dispatch<SetStateAction<string>>;
    issuedEdit: boolean;
    setIssuedEdit: Dispatch<SetStateAction<boolean>>;
    selectedIssued: string;
    setSelectedIssued: Dispatch<SetStateAction<string>>;
    aliasName: string;
    setAliasName: (value: string) => Promise<void>;
    aliasDID: string;
    setAliasDID: (value: string) => Promise<void>;
    nameList: Record<string, string>;
    setNameList: Dispatch<SetStateAction<Record<string, string>>>;
    agentList: string[];
    setAgentList: Dispatch<SetStateAction<string[]>>;
    resetCredentialState: () => void;
    refreshCredentialsStored: (state: Record<string, any>) => Promise<void>;
}

const CredentialsContext = createContext<CredentialsContextValue | null>(null);

export function CredentialsProvider({ children }: { children: ReactNode }) {
    const [heldList, setHeldList] = useState<string[]>([]);
    const [heldDID, setHeldDIDState] = useState<string>("");
    const [nameList, setNameList] = useState<Record<string, string>>({});
    const [agentList, setAgentList] = useState<string[]>([]);
    const [groupList, setGroupList] = useState<string[]>([]);
    const [imageList, setImageList] = useState<string[]>([]);
    const [schemaList, setSchemaList] = useState<string[]>([]);
    const [issuedList, setIssuedList] = useState<string[]>([]);
    const [issuedString, setIssuedString] = useState<string>("");
    const [issuedEdit, setIssuedEdit] = useState<boolean>(false);
    const [issuedStringOriginal, setIssuedStringOriginal] = useState<string>("");
    const [selectedIssued, setSelectedIssued] = useState<string>("");
    const [credentialDID, setCredentialDID] = useState<string>("");
    const [credentialSubject, setCredentialSubject] = useState<string>("");
    const [credentialSchema, setCredentialSchema] = useState<string>("");
    const [credentialString, setCredentialString] = useState<string>("");
    const [aliasName, setAliasNameState] = useState<string>("");
    const [aliasDID, setAliasDIDState] = useState<string>("");
    const {
        storeState,
    } = useWalletContext();

    async function setHeldDID(value: string) {
        setHeldDIDState(value);
        await storeState("heldDID", value);
    }

    async function setAliasName(value: string) {
        setAliasNameState(value);
        await storeState("aliasName", value);
    }

    async function setAliasDID(value: string) {
        setAliasDIDState(value);
        await storeState("aliasDID", value);
    }

    function resetCredentialState() {
        setAliasNameState("");
        setAliasDIDState("");
        setHeldDIDState("");
    }

    async function refreshCredentialsStored(state: Record<string, any>) {
        if (state.heldDID) {
            setHeldDIDState(state.heldDID);
        }

        if (state.aliasName) {
            setAliasNameState(state.aliasName);
        }

        if (state.aliasDID) {
            setAliasDIDState(state.aliasDID);
        }
    }

    const value: CredentialsContextValue = {
        heldDID,
        setHeldDID,
        heldList,
        setHeldList,
        groupList,
        setGroupList,
        imageList,
        setImageList,
        schemaList,
        setSchemaList,
        issuedList,
        setIssuedList,
        issuedString,
        setIssuedString,
        issuedStringOriginal,
        setIssuedStringOriginal,
        issuedEdit,
        setIssuedEdit,
        selectedIssued,
        setSelectedIssued,
        credentialDID,
        setCredentialDID,
        credentialSubject,
        setCredentialSubject,
        credentialSchema,
        setCredentialSchema,
        credentialString,
        setCredentialString,
        aliasName,
        setAliasName,
        aliasDID,
        setAliasDID,
        nameList,
        setNameList,
        agentList,
        setAgentList,
        resetCredentialState,
        refreshCredentialsStored,
    }

    return (
        <CredentialsContext.Provider value={value}>
            {children}
        </CredentialsContext.Provider>
    );
}

export function useCredentialsContext() {
    const ctx = useContext(CredentialsContext);
    if (!ctx) {
        throw new Error('useCredentialsContext must be used within CredentialsProvider');
    }
    return ctx;
}

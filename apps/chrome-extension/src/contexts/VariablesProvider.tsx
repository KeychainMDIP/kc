import React, { createContext, Dispatch, ReactNode, SetStateAction, useContext, useState } from "react";
import { useWalletContext } from "./WalletProvider";
import {DmailItem} from "@mdip/keymaster/types";

interface VariablesContextValue {
    currentId: string;
    setCurrentId: (value: string) => Promise<void>;
    validId: boolean;
    setValidId: Dispatch<SetStateAction<boolean>>;
    currentDID: string;
    setCurrentDID: Dispatch<SetStateAction<string>>;
    registry: string;
    setRegistry: (value: string) => Promise<void>;
    registries: string[];
    setRegistries: Dispatch<SetStateAction<string[]>>;
    idList: string[];
    setIdList: Dispatch<SetStateAction<string[]>>;
    unresolvedIdList: string[];
    setUnresolvedIdList: Dispatch<SetStateAction<string[]>>;
    manifest: Record<string, unknown> | undefined;
    setManifest: Dispatch<SetStateAction<Record<string, unknown> | undefined>>;
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
    vaultList: string[];
    setVaultList: Dispatch<SetStateAction<string[]>>;
    groupList: string[];
    setGroupList: Dispatch<SetStateAction<string[]>>;
    imageList: string[];
    setImageList: Dispatch<SetStateAction<string[]>>;
    documentList: string[];
    setDocumentList: Dispatch<SetStateAction<string[]>>;
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
    dmailList: Record<string, DmailItem>;
    setDmailList: Dispatch<SetStateAction<Record<string, DmailItem>>>;
    aliasName: string;
    setAliasName: (value: string) => Promise<void>;
    aliasDID: string;
    setAliasDID: (value: string) => Promise<void>;
    nameList: Record<string, string>;
    setNameList: Dispatch<SetStateAction<Record<string, string>>>;
    nameRegistry: Record<string, string>;
    setNameRegistry: Dispatch<SetStateAction<Record<string, string>>>;
    unresolvedList: Record<string, string>;
    setUnresolvedList: Dispatch<SetStateAction<Record<string, string>>>;
    agentList: string[];
    setAgentList: Dispatch<SetStateAction<string[]>>;
    pollList: string[];
    setPollList: Dispatch<SetStateAction<string[]>>;
    resetCredentialState: () => void;
    refreshCredentialsStored: (state: Record<string, any>) => Promise<void>;
    refreshRegistryStored: (state: Record<string, any>) => Promise<void>;
    storeState: (key: string, value: string | boolean) => Promise<void>;
}

const VariablesContext = createContext<VariablesContextValue | null>(null);

export function VariablesProvider({ children }: { children: ReactNode }) {
    const [currentId, setCurrentIdState] = useState<string>("");
    const [validId, setValidId] = useState<boolean>(false);
    const [currentDID, setCurrentDID] = useState<string>("");
    const [idList, setIdList] = useState<string[]>([]);
    const [unresolvedIdList, setUnresolvedIdList] = useState<string[]>([]);
    const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(undefined);
    const [registry, setRegistryState] = useState<string>("hyperswarm");
    const [registries, setRegistries] = useState<string[]>([]);
    const [heldList, setHeldList] = useState<string[]>([]);
    const [heldDID, setHeldDIDState] = useState<string>("");
    const [nameList, setNameList] = useState<Record<string, string>>({});
    const [nameRegistry, setNameRegistry] = useState<Record<string, string>>({});
    const [unresolvedList, setUnresolvedList] = useState<Record<string, string>>({});
    const [agentList, setAgentList] = useState<string[]>([]);
    const [pollList, setPollList] = useState<string[]>([]);
    const [groupList, setGroupList] = useState<string[]>([]);
    const [imageList, setImageList] = useState<string[]>([]);
    const [documentList, setDocumentList] = useState<string[]>([]);
    const [schemaList, setSchemaList] = useState<string[]>([]);
    const [vaultList, setVaultList] = useState<string[]>([]);
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
    const [dmailList, setDmailList] = useState<Record<string, DmailItem>>({});
    const { isBrowser } = useWalletContext();

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

    async function setCurrentId(value: string) {
        setCurrentIdState(value);
        await storeState("currentId", value);
    }

    async function setRegistry(value: string) {
        setRegistryState(value);
        await storeState("registry", value);
    }

    function resetCredentialState() {
        setAliasNameState("");
        setAliasDIDState("");
        setHeldDIDState("");
        setCurrentIdState("");
        setRegistryState("hyperswarm");
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

    async function refreshRegistryStored(state: Record<string, any>) {
        if (state.registry) {
            setRegistryState(state.registry);
        }
    }

    async function storeState(key: string, value: string | boolean) {
        if (isBrowser) {
            return;
        }
        await chrome.runtime.sendMessage({
            action: "STORE_STATE",
            key,
            value,
        });
    }

    const value: VariablesContextValue = {
        currentId,
        setCurrentId,
        validId,
        setValidId,
        currentDID,
        setCurrentDID,
        registry,
        setRegistry,
        registries,
        setRegistries,
        idList,
        setIdList,
        unresolvedIdList,
        setUnresolvedIdList,
        manifest,
        setManifest,
        heldDID,
        setHeldDID,
        heldList,
        setHeldList,
        groupList,
        setGroupList,
        imageList,
        setImageList,
        documentList,
        setDocumentList,
        schemaList,
        setSchemaList,
        vaultList,
        setVaultList,
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
        nameRegistry,
        setNameRegistry,
        unresolvedList,
        setUnresolvedList,
        agentList,
        setAgentList,
        pollList,
        setPollList,
        dmailList,
        setDmailList,
        storeState,
        resetCredentialState,
        refreshCredentialsStored,
        refreshRegistryStored,
    }

    return (
        <VariablesContext.Provider value={value}>
            {children}
        </VariablesContext.Provider>
    );
}

export function useVariablesContext() {
    const ctx = useContext(VariablesContext);
    if (!ctx) {
        throw new Error('useVariablesContext must be used within VariablesProvider');
    }
    return ctx;
}

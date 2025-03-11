export type CreateChallengeOptions = {
    controller?: string;
    registry?: string;
    validUntil?: string;
};

export type CreateResponseOptions = CreateChallengeOptions & {
    delay?: number;
    includeHash?: boolean;
    retries?: number;
};

export type ConstructorOptions = {
    gatekeeper: any;
    wallet: any;
    cipher: any;
};

export type CheckWalletResult = {
    checked: number;
    invalid: number;
    deleted: number;
};

export type FixWalletResult = {
    idsRemoved: number;
    ownedRemoved: number;
    heldRemoved: number;
    namesRemoved: number;
};

export type AssetOptions = {
    registry?: string;
    controller?: string;
    validUntil?: string;
}

export type EncryptOptions = AssetOptions & {
    encryptForSender?: boolean;
    includeHash?: boolean;
}

export type VotePollOptions = EncryptOptions & {
    spoil?: boolean;
}

export type BindCredentialOptions = {
    validFrom?: string;
    validUntil?: string;
    credential?: any;
}

export type IssueCredentialOptions = BindCredentialOptions & EncryptOptions & {
    schema?: string;
    subject?: string;
}

export type CreateGroupOptions = AssetOptions & {
    members?: string[];
}

export type PollTemplate = {
    type: string;
    version: number;
    description: string;
    roster: string;
    options: string[];
    deadline: string;
}

declare module '@mdip/keymaster' {
    export default class Keymaster {
        acceptCredential(did: string): Promise<boolean>;
        addName(name: string, did: any): Promise<boolean>;
        addGroupMember(groupId: string, memberId: string): Promise<boolean>;
        addSignature(obj: any, controller?: string): Promise<any>;
        addToHeld(did: string): Promise<boolean>;
        addToOwned(did: string): Promise<boolean>;
        acceptCredential(did: string): Promise<any>;
        backupId(controller?: string): Promise<boolean>;
        backupWallet(registry?: string): Promise<string>;
        bindCredential(schemaId: string, subjectId: string, options?: BindCredentialOptions): Promise<any>;
        constructor(options: ConstructorOptions);
        checkWallet(): Promise<CheckWalletResult>;
        createAsset(data: any, options?: AssetOptions): Promise<string>;
        createChallenge(challenge?: { credentials: any[] }, options?: CreateChallengeOptions): Promise<string>;
        createGroup(name: string, options?: CreateGroupOptions): Promise<string>;
        createResponse(challenge: string, options?: CreateResponseOptions): Promise<string>;
        createId(name: string, options?: { registry?: string }): Promise<string>;
        createPoll(poll: PollTemplate, options?: AssetOptions): Promise<string>;
        createSchema(schema: any, options?: AssetOptions): Promise<string>;
        createTemplate(schemaId: string): Promise<any>;
        decryptJSON(did: string): Promise<any>;
        decryptMessage(did: string): Promise<string>;
        decryptMnemonic(): Promise<string>;
        encryptJSON(json: any, did: string, options?: EncryptOptions): Promise<any>;
        encryptMessage(msg: string, receiver: string, options?: EncryptOptions): Promise<string>;
        fetchIdInfo(id?: string): Promise<any>;
        fetchKeyPair(): Promise<any>;
        findMatchingCredential(credential: any): Promise<any>;
        fixWallet(): Promise<FixWalletResult>;
        generateSchema(schema: any): any;
        getCredential(id: string): Promise<any>;
        getCurrentId(): Promise<string>;
        getGroup(id: string): Promise<string[] | null>;
        getName(name: string): Promise<string | null>;
        getPoll(id: string): Promise<PollTemplate | null>;
        getSchema(id: string): Promise<any>;
        hdKeyPair(name?: string): Promise<any>;
        issueCredential(credential: any, options?: IssueCredentialOptions): Promise<any>;
        loadWallet(): Promise<any>;
        lookupDID(name: string): Promise<any>;
        listAssets(owner: string): Promise<any>;
        listCredentials(): Promise<any>;
        listGroups(owner: string): Promise<string[]>;
        listIds(): Promise<string[]>;
        listIssued(issuer?: string): Promise<any>;
        listNames(): Promise<any>;
        listRegistries(): Promise<any>;
        listSchemas(owner: string): Promise<any>;
        newWallet(mnemonic?: string, overwrite?: boolean): Promise<any>;
        pollTemplate(): Promise<PollTemplate>;
        publishCredential(did: string, options?: { reveal?: boolean }): Promise<any>;
        publishPoll(pollId: string, options?: { reveal?: boolean }): Promise<boolean>;
        recoverId(did: string): Promise<string>;
        recoverWallet(did?: string): Promise<any>;
        renameId(id: string, name: string): Promise<any>;
        removeCredential(id: string): Promise<any>;
        removeGroupMember(groupId: string, memberId: string): Promise<boolean>;
        removeFromHeld(did: string): Promise<boolean>;
        removeFromOwned(did: string, owner: string): Promise<boolean>;
        removeId(name: string): Promise<boolean>;
        removeName(name: string): Promise<boolean>;
        resolveAsset(did: string): Promise<any>;
        resolveDID(did: string, options?: any): Promise<any>;
        resolveSeedBank(): Promise<any>;
        revokeCredential(credential: any): Promise<boolean>;
        revokeDID(did: string): Promise<boolean>;
        rotateKeys(): Promise<boolean>;
        saveWallet(wallet: any, overwrite?: boolean): Promise<boolean>;
        setCurrentId(name: string): Promise<any>;
        setSchema(id: string, schema: any): Promise<boolean>;
        testAgent(id: string): Promise<boolean>;
        testGroup(groupId: string, memberId?: string): Promise<boolean>;
        testSchema(id: string): Promise<boolean>;
        unpublishCredential(did: string): Promise<string>;
        unpublishPoll(pollId: string): Promise<boolean>;
        updateAsset(did: string, data: any): Promise<boolean>;
        updateCredential(did: string, credential: any): Promise<boolean>;
        updateDID(doc: any): Promise<boolean>;
        updatePoll(ballot: string): Promise<boolean>;
        updateSeedBank(doc: any): Promise<boolean>;
        viewPoll(pollId: string): Promise<any>;
        votePoll(pollId: string, vote: string, options?: VotePollOptions): Promise<any>;
        validateSchema(schema: any): boolean;
        verifyResponse(did: string, options?: { retries?: number, delay?: number }): Promise<string>;
        verifySignature(obj: any): Promise<boolean>;
    }
}

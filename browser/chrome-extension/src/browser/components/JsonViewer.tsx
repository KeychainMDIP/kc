import React, {
    CSSProperties,
    ReactNode,
    useEffect,
    useState
} from "react";
import JsonView from '@uiw/react-json-view';
import {
    Box,
    Button,
    TextField,
    Typography
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import {MdipDocument} from "@mdip/gatekeeper/types";
import VersionNavigator from "./VersionNavigator";

function JsonViewer({browserTab, browserSubTab, showResolveField = false}: {browserTab: string, browserSubTab?: string, showResolveField?: boolean}) {
    const subTabKey = browserSubTab ?? 'noSubTab';
    const storageKey = `jsonViewerState-${browserTab}-${subTabKey}`;

    const [aliasDocs, setAliasDocs] = useState<Record<string, unknown> | undefined>(undefined);
    const [aliasDocsVersion, setAliasDocsVersion] = useState<number>(1);
    const [aliasDocsVersionMax, setAliasDocsVersionMax] = useState<number>(1);
    const [formDid, setFormDid] = useState<string>("");
    const [currentDid, setCurrentDid] = useState<string>("");
    const [currentTitle, setCurrentTitle] = useState<string>("");
    const { keymaster, setError } = useWalletContext();
    const { openBrowser, setOpenBrowser } = useUIContext();
    const [canDecrypt,     setCanDecrypt]     = useState(false);
    const [decryptedCache, setDecryptedCache] = useState<Record<string, unknown>|null>(null);

    const isEncrypted = Boolean(
        (aliasDocs as any)?.didDocumentData?.encrypted,
    );

    useEffect(() => {
        async function checkDecryptability() {
            setCanDecrypt(false);
            setDecryptedCache(null);

            if (!keymaster || !isEncrypted) {
                return;
            }

            try {
                const decrypted = await keymaster.decryptJSON(
                    (aliasDocs as any).didDocument.id,
                );
                if (typeof decrypted === 'object' && decrypted !== null) {
                    setCanDecrypt(true);
                    setDecryptedCache(decrypted as Record<string, unknown>);
                }
            } catch {}
        }
        checkDecryptability();
    }, [aliasDocs, keymaster, isEncrypted]);

    async function handleDecrypt() {
        if (!canDecrypt || !decryptedCache) {
            return;
        }
        setAliasDocs(decryptedCache);
    }

    useEffect(() => {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setAliasDocs(parsed.aliasDocs);
                setAliasDocsVersion(parsed.aliasDocsVersion ?? 1);
                setAliasDocsVersionMax(parsed.aliasDocsVersionMax ?? 1);
                setFormDid(parsed.formDid ?? "");
                setCurrentDid(parsed.currentDid ?? "");
                setCurrentTitle(parsed.currentTitle ?? "");
            } catch (e) {}
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!aliasDocs) {
            return;
        }
        const stateToStore = {
            aliasDocs,
            aliasDocsVersion,
            aliasDocsVersionMax,
            formDid,
            currentDid,
            currentTitle
        };
        sessionStorage.setItem(storageKey, JSON.stringify(stateToStore));
    }, [
        aliasDocs,
        aliasDocsVersion,
        aliasDocsVersionMax,
        formDid,
        currentDid,
        currentTitle,
        storageKey
    ]);

    useEffect(() => {
        if (!openBrowser) {
            return;
        }

        const {title, did, tab, subTab, contents, clearState} = openBrowser;

        if (clearState) {
            setAliasDocs(undefined);
            setCurrentTitle("");
            return;
        }

        if (tab !== browserTab || (subTab && subTab !== browserSubTab)) {
            return;
        }

        setAliasDocs(undefined);
        setCurrentTitle("");

        if (!did && !contents) {
            sessionStorage.removeItem(storageKey);
            return;
        }

        const populateData = async () => {
            try {
                if (contents) {
                    setAliasDocs(contents);
                } else if (did) {
                    await resolveDID(did);
                }
            } catch (error: any) {
                setError(error);
            }
        };

        populateData();

        if (did) {
            setFormDid(did);
        }
        if (title) {
            setCurrentTitle(title);
        }
        if (setOpenBrowser) {
            setOpenBrowser(undefined);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openBrowser]);

    async function handleResolveDID(did?: string) {
        if (setOpenBrowser) {
            setOpenBrowser({
                title: "",
                did: did || formDid,
                tab: browserTab === "wallet" ? "viewer" : browserTab,
                subTab: browserSubTab,
            });
        }
    }

    async function resolveDID(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            const docs = await keymaster.resolveDID(did);
            if (!docs.didDocumentMetadata) {
                setError("Invalid DID");
                return;
            }
            const versions = docs.didDocumentMetadata.version;

            setAliasDocs(docs as Record<string, unknown>);
            if (versions) {
                setAliasDocsVersion(versions);
                setAliasDocsVersionMax(versions);
            }
            setCurrentDid(did);
        } catch (error: any) {
            setError(error);
        }
    }

    async function selectAliasDocsVersion(version: number) {
        if (!keymaster) {
            return;
        }
        try {
            setAliasDocsVersion(version);
            const docs = await keymaster.resolveDID(currentDid, {
                atVersion: version,
            });
            setAliasDocs(docs as Record<string, unknown>);
        } catch (error: any) {
            setError(error);
        }
    }

    function trimQuotes(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
        let newValue = e.target.value;
        if (newValue.startsWith('"')) {
            newValue = newValue.slice(1);
        }
        if (newValue.endsWith('"')) {
            newValue = newValue.slice(0, -1);
        }
        setFormDid(newValue);
    }

    return (
        <Box>
            {showResolveField &&
                <Box className="flex-box" sx={{ my: 2 }}>
                    <TextField
                        label="Resolve DID"
                        variant="outlined"
                        value={formDid}
                        onChange={(e) => trimQuotes(e)}
                        size="small"
                        className="text-field single-line"
                        slotProps={{
                            htmlInput: {
                                maxLength: 80,
                            },
                        }}
                    />
                    <Button
                        variant="contained"
                        onClick={() => handleResolveDID()}
                        size="small"
                        className="button-center"
                        disabled={!formDid}
                    >
                        Resolve
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleDecrypt}
                        size="small"
                        className="button-right"
                        disabled={!canDecrypt}
                    >
                        Decrypt
                    </Button>
                </Box>
            }
            {currentTitle &&
                <Typography variant="h5" component="h5">
                    {currentTitle}
                </Typography>
            }
            {aliasDocs && (
                <Box>
                    {aliasDocsVersionMax > 1 &&
                        <Box sx={{ mt: 1 }}>
                            <VersionNavigator
                                version={aliasDocsVersion}
                                maxVersion={aliasDocsVersionMax}
                                onVersionChange={selectAliasDocsVersion}
                            />
                        </Box>
                    }
                    <Box sx={{ mt: 2 }}>
                        <JsonView
                            value={aliasDocs}
                            shortenTextAfterLength={0}
                        >
                            <JsonView.String
                                render={(
                                    viewRenderProps: {
                                        children?: ReactNode;
                                        style?: CSSProperties;
                                        [key: string]: any;
                                    },
                                    nodeInfo: {
                                        value?: unknown;
                                        type: "type" | "value";
                                        keyName?: string | number;
                                    }
                                ) => {
                                    const { children, style, ...rest } = viewRenderProps;
                                    const { value, type, keyName } = nodeInfo;

                                    if (typeof value === 'string' && value.startsWith('did:') && type === 'value') {
                                        return (
                                            <span
                                                {...rest}
                                                style={{ ...style, color: 'blue', textDecoration: 'underline', cursor: 'pointer' }}
                                                onClick={() => handleResolveDID(value)}
                                            >
                                                {children}
                                            </span>
                                        );
                                    }

                                    if (type === 'value' &&
                                        (aliasDocs as MdipDocument)?.didDocumentMetadata?.timestamp?.chain === "TBTC"
                                    ) {
                                        const currentKeyString = String(keyName);
                                        let url = '';

                                        if (currentKeyString === 'blockid') {
                                            url = `https://mempool.space/testnet4/block/${value}`;
                                        } else if (currentKeyString === 'txid') {
                                            url = `https://mempool.space/testnet4/tx/${value}`;
                                        }

                                        if (url) {
                                            return (
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ ...style, color: 'blue', textDecoration: 'underline', cursor: 'pointer' }}
                                                >
                                                    {children}
                                                </a>
                                            );
                                        }
                                    }

                                    return undefined;
                                }}
                            />
                        </JsonView>
                    </Box>
                </Box>
            )}
        </Box>
    );
}

export default JsonViewer;

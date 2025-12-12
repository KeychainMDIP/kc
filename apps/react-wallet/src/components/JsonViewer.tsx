import React, {
    CSSProperties,
    ReactNode,
    useEffect,
    useState
} from "react";
import JsonView from '@uiw/react-json-view';
import {
    Box,
    TextField,
    IconButton,
    Tooltip,
    InputAdornment,
} from "@mui/material";
import {
    LockOpen,
    ManageSearch,
} from "@mui/icons-material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useUIContext } from "../contexts/UIContext";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { MdipDocument } from "@mdip/gatekeeper/types";
import VersionNavigator from "./VersionNavigator";

function JsonViewer({ browserTab, browserSubTab, showResolveField = false }: { browserTab: string, browserSubTab?: string, showResolveField?: boolean }) {
    const [aliasDocs, setAliasDocs] = useState<Record<string, unknown> | undefined>(undefined);
    const [aliasDocsVersion, setAliasDocsVersion] = useState<number>(1);
    const [aliasDocsVersionMax, setAliasDocsVersionMax] = useState<number>(1);
    const [formDid, setFormDid] = useState<string>("");
    const [currentDid, setCurrentDid] = useState<string>("");
    const { keymaster } = useWalletContext();
    const { setError } = useSnackbar();
    const { openBrowser, setOpenBrowser } = useUIContext();
    const [canDecrypt, setCanDecrypt] = useState(false);
    const [decryptedCache, setDecryptedCache] = useState<Record<string, unknown> | null>(null);

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
            } catch { }
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
        if (!openBrowser) {
            return;
        }

        const { did, tab, subTab, contents, clearState } = openBrowser;

        if (clearState) {
            setAliasDocs(undefined);
            return;
        }

        if (tab !== browserTab || (subTab && subTab !== browserSubTab)) {
            return;
        }

        setAliasDocs(undefined);

        if (!did && !contents) {
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

        setOpenBrowser(undefined);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openBrowser]);

    async function handleResolveDID(did?: string) {
        setOpenBrowser({
            did: did || formDid,
            tab: browserTab === "wallet" ? "viewer" : browserTab,
            subTab: browserSubTab,
        });
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
            const versions = parseInt(docs.didDocumentMetadata.version ?? "1", 10);

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
                versionSequence: version,
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
        <Box sx={{ width: "100%", overflowX: "hidden" }}>
            {(showResolveField || aliasDocsVersionMax > 1) && (
                <Box
                    sx={{
                        position: "sticky",
                        top: 0,
                        zIndex: (t) => t.zIndex.appBar,
                        bgcolor: "background.paper",
                        pt: 2,
                        pb: 1,
                        left: 0,
                        right: 0,
                    }}
                >
                    {showResolveField &&
                        <Box className="flex-box" sx={{ my: 1 }}>
                            <TextField
                                label="Resolve DID"
                                variant="outlined"
                                value={formDid}
                                onChange={(e) => trimQuotes(e)}
                                size="small"
                                className="text-field single-line"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && formDid) {
                                        e.preventDefault();
                                        handleResolveDID();
                                    }
                                }}
                                slotProps={{
                                    htmlInput: {
                                        maxLength: 80,
                                    },
                                    input: {
                                        endAdornment: (
                                            <InputAdornment position="end" sx={{ gap: 0.5 }}>
                                                <Tooltip title="Resolve DID" placement="top">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => handleResolveDID()}
                                                            disabled={!formDid}
                                                        >
                                                            <ManageSearch fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                                <Tooltip title="Decrypt" placement="top">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={handleDecrypt}
                                                            disabled={!canDecrypt}
                                                        >
                                                            <LockOpen fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </InputAdornment>
                                        ),
                                    }
                                }}
                            />
                        </Box>
                    }

                    {aliasDocs && aliasDocsVersionMax > 1 && (
                        <Box>
                            <VersionNavigator
                                version={aliasDocsVersion}
                                maxVersion={aliasDocsVersionMax}
                                onVersionChange={selectAliasDocsVersion}
                            />
                        </Box>
                    )}
                </Box>
            )}

            {aliasDocs && (
                <Box sx={{ mt: 1, overflowX: "auto", overflowY: "visible", WebkitOverflowScrolling: "touch" }}>
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
            )}
        </Box>
    );
}

export default JsonViewer;

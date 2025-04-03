import React, { useEffect, useState } from "react";
import JsonView from '@uiw/react-json-view';
import {
    Box,
    Button,
    MenuItem,
    Select, TextField,
    Typography
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import {MdipDocument} from "@mdip/gatekeeper/types";

function JsonViewer({browserTab, browserSubTab, showResolveField = false}: {browserTab: string, browserSubTab?: string, showResolveField?: boolean}) {
    const subTabKey = browserSubTab ?? 'noSubTab';
    const storageKey = `jsonViewerState-${browserTab}-${subTabKey}`;

    const [aliasDocs, setAliasDocs] = useState<MdipDocument | undefined>(undefined);
    const [aliasDocsVersion, setAliasDocsVersion] = useState<number>(1);
    const [aliasDocsVersionMax, setAliasDocsVersionMax] = useState<number>(1);
    const [aliasDocsVersions, setAliasDocsVersions] = useState<number[] | undefined>(undefined);
    const [formDid, setFormDid] = useState<string>("");
    const [currentDid, setCurrentDid] = useState<string>("");
    const [currentTitle, setCurrentTitle] = useState<string>("");
    const { keymaster, setError } = useWalletContext();
    const { openBrowser, setOpenBrowser } = useUIContext();

    useEffect(() => {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setAliasDocs(parsed.aliasDocs);
                setAliasDocsVersion(parsed.aliasDocsVersion ?? 1);
                setAliasDocsVersionMax(parsed.aliasDocsVersionMax ?? 1);
                setAliasDocsVersions(parsed.aliasDocsVersions);
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
            aliasDocsVersions,
            formDid,
            currentDid,
            currentTitle
        };
        sessionStorage.setItem(storageKey, JSON.stringify(stateToStore));
    }, [
        aliasDocs,
        aliasDocsVersion,
        aliasDocsVersionMax,
        aliasDocsVersions,
        formDid,
        currentDid,
        currentTitle,
        storageKey
    ]);

    useEffect(() => {
        if (!openBrowser) {
            return;
        }

        const {title, did, tab, subTab, contents} = openBrowser;

        if (tab !== browserTab || (subTab && subTab !== browserSubTab)) {
            return;
        }

        setAliasDocsVersions(undefined);
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
                setError(error.error || error.message || String(error));
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

            setAliasDocs(docs);
            if (versions) {
                setAliasDocsVersion(versions);
                setAliasDocsVersionMax(versions);
                setAliasDocsVersions(
                    Array.from({ length: versions }, (_, i) => i + 1),
                );
            }
            setCurrentDid(did);
        } catch (error: any) {
            setError(error.error || error.message || String(error));
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
            setAliasDocs(docs);
        } catch (error: any) {
            setError(error.error || error.message || String(error));
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
                        className="button-right"
                        disabled={!formDid}
                    >
                        Resolve
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
                    {aliasDocsVersions &&
                        <Box sx={{ display: "flex", alignItems: "center" }}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => selectAliasDocsVersion(1)}
                                disabled={aliasDocsVersion === 1}
                                sx={{
                                    height: 40,
                                    borderTopRightRadius: 0,
                                    borderBottomRightRadius: 0,
                                }}
                            >
                                First
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() =>
                                    selectAliasDocsVersion(aliasDocsVersion - 1)
                                }
                                disabled={aliasDocsVersion === 1}
                                sx={{
                                    height: 40,
                                    borderRadius: 0,
                                }}
                            >
                                Prev
                            </Button>
                            <Select
                                style={{ width: "150px", height: "40px" }}
                                value={aliasDocsVersion}
                                fullWidth
                                onChange={(event) =>
                                    selectAliasDocsVersion(
                                        event.target.value as number,
                                    )
                                }
                                sx={{
                                    height: 40,
                                    borderRadius: 0,
                                    "& .MuiOutlinedInput-root": {
                                        borderRadius: 0,
                                    },
                                }}
                            >
                                {aliasDocsVersions.map((version, index) => (
                                    <MenuItem value={version} key={index}>
                                        version {version}
                                    </MenuItem>
                                ))}
                            </Select>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() =>
                                    selectAliasDocsVersion(aliasDocsVersion + 1)
                                }
                                disabled={aliasDocsVersion === aliasDocsVersionMax}
                                sx={{
                                    height: 40,
                                    borderRadius: 0,
                                }}
                            >
                                Next
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() =>
                                    selectAliasDocsVersion(aliasDocsVersionMax)
                                }
                                disabled={aliasDocsVersion === aliasDocsVersionMax}
                                sx={{
                                    height: 40,
                                    borderTopLeftRadius: 0,
                                    borderBottomLeftRadius: 0,
                                }}
                            >
                                Last
                            </Button>
                        </Box>
                    }
                    <Box sx={{ mt: 2 }}>
                        <JsonView
                            value={aliasDocs}
                            shortenTextAfterLength={0}
                        >
                            <JsonView.String
                                render={({ children, style, ...rest }, { type, value }) => {
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

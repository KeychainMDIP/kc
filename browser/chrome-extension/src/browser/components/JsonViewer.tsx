import React, { useEffect, useState } from "react";
import JsonView from "@uiw/react-json-view";
import {
    Box,
    Button,
    MenuItem,
    Select, TextField,
    Typography
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";

function JsonViewer({title, rawJson, did, dedicated = false}: {title: string, rawJson?: string, did: string, dedicated?: boolean}) {
    const [aliasDocs, setAliasDocs] = useState<any>(null);
    const [aliasDocsVersion, setAliasDocsVersion] = useState<number>(1);
    const [aliasDocsVersionMax, setAliasDocsVersionMax] = useState<number>(1);
    const [aliasDocsVersions, setAliasDocsVersions] = useState<any | null>(null);
    const [formDid, setFormDid] = useState<string>("");
    const [currentDid, setCurrentDid] = useState<string>("");
    const [currentTitle, setCurrentTitle] = useState<string>("");
    const { keymaster, setError } = useWalletContext();

    useEffect(() => {
        if (!did) {
            return;
        }

        const populateData = async () => {
            try {
                if (rawJson) {
                    const parsed = JSON.parse(rawJson);
                    setAliasDocs(parsed);
                } else {
                    await resolveDID(did);
                }
            } catch (error) {
                setError(error.error || error.message || String(error));
            }
        };

        setAliasDocsVersions(null);
        setAliasDocs(null);
        populateData();
        setFormDid(did);
        setCurrentTitle(title);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawJson, title, did]);

    async function handleResolveDID() {
        await resolveDID(formDid);
        setCurrentTitle("");
    }

    async function resolveDID(did: string) {
        try {
            const docs = await keymaster.resolveDID(did);
            const versions = docs.didDocumentMetadata.version;

            setAliasDocs(docs);
            setAliasDocsVersion(versions);
            setAliasDocsVersionMax(versions);
            setAliasDocsVersions(
                Array.from({ length: versions }, (_, i) => i + 1),
            );
            setCurrentDid(did);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function selectAliasDocsVersion(version: number) {
        try {
            setAliasDocsVersion(version);
            const docs = await keymaster.resolveDID(currentDid, {
                atVersion: version,
            });
            setAliasDocs(docs);
        } catch (error) {
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
            {dedicated &&
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
                        onClick={handleResolveDID}
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
                        />
                    </Box>
                </Box>
            )}
        </Box>
    );
}

export default JsonViewer;

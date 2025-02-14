import React, { useEffect, useState } from "react";
import JsonView from "@uiw/react-json-view";
import {
    Box,
    Button,
    MenuItem,
    Select,
    Typography,
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";

function JsonViewer({title, rawJson, did}: {title: string, rawJson?: string, did: string}) {
    const [data, setData] = useState<any>(null);
    const [aliasDocs, setAliasDocs] = useState<any>(null);
    const [aliasDocsVersion, setAliasDocsVersion] = useState(1);
    const [aliasDocsVersionMax, setAliasDocsVersionMax] = useState(1);
    const [aliasDocsVersions, setAliasDocsVersions] = useState([]);
    const { keymaster, setError } = useWalletContext();

    useEffect(() => {
        const populateData = async () => {
            try {
                if (rawJson) {
                    const parsed = JSON.parse(rawJson);
                    setData(parsed);
                } else {
                    await resolveDID(did);
                }
            } catch (e) {
                setData({ error: "Failed to populate JSON" });
            }
        };

        setData("");
        setAliasDocs(null);
        populateData();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawJson, did]);

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
        } catch {
            setData({ error: "Failed to populate JSON" });
        }
    }

    async function selectAliasDocsVersion(version: number) {
        try {
            setAliasDocsVersion(version);
            const docs = await keymaster.resolveDID(did, {
                atVersion: version,
            });
            setAliasDocs(docs);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    return (
        <Box>
            <Typography variant="h5" component="h5">
                {title}
            </Typography>
            {did && (
                <Typography sx={{ fontFamily: "Courier, monospace" }}>
                    {did}
                </Typography>
            )}
            {data && <JsonView value={data} shortenTextAfterLength={0} />}
            {aliasDocs && (
                <Box>
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

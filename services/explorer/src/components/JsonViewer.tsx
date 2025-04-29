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
    FormControl,
    MenuItem,
    Select,
    TextField,
    Typography,
    IconButton
} from "@mui/material";
import {
    GatekeeperInterface,
    MdipDocument
} from "@mdip/gatekeeper/types";
import ContentCopy from "@mui/icons-material/ContentCopy";
import { handleCopyDID } from '../shared/utilities.js';
import axios from "axios";

const searchServerURL = import.meta.env.EXPLORER_SEARCH_SERVER || "http://localhost:3001";
const VERSION = '/api/v1';

function JsonViewer(
    {
        gatekeeper,
        setError,
        viewDid,
        setViewDid,
    }: {
        gatekeeper: GatekeeperInterface;
        setError: (error: any) => void;
        viewDid: string;
        setViewDid: (did: string) => void;
    }) {
    const [aliasDocs, setAliasDocs] = useState<MdipDocument | undefined>(undefined);
    const [aliasDocsVersion, setAliasDocsVersion] = useState<number>(1);
    const [aliasDocsVersionMax, setAliasDocsVersionMax] = useState<number>(1);
    const [aliasDocsVersions, setAliasDocsVersions] = useState<number[] | undefined>(undefined);
    const [formDid, setFormDid] = useState<string>("");
    const [currentDid, setCurrentDid] = useState<string>("");
    const [jsonDID, setJsonDID] = useState<string | undefined>(undefined);
    const [searchResults, setSearchResults] = useState<string[] | null>(null);
    const [searchPage, setSearchPage] = useState<number>(0);
    const [searchCount, setSearchCount] = useState<number>(50);

    useEffect(() => {
        if (!viewDid) {
            return;
        }
        handleResolveDID(viewDid);
        setViewDid("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewDid]);

    useEffect(() => {
        if (!jsonDID) {
            return;
        }

        setAliasDocsVersions(undefined);
        setAliasDocs(undefined);

        const populateData = async () => {
            try {
                await resolveDID(jsonDID);
            } catch (error: any) {
                setError(error);
            }
        };

        populateData();

        setFormDid(jsonDID);
        setJsonDID(undefined);
        setSearchResults(null);
        setSearchPage(0);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jsonDID]);

    async function handleResolveDID(did?: string) {
        setJsonDID(did || formDid);
    }

    async function resolveDID(did: string) {
        try {
            const docs = await gatekeeper.resolveDID(did);
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
            setError(error);
        }
    }

    async function selectAliasDocsVersion(version: number) {
        try {
            setAliasDocsVersion(version);
            const docs = await gatekeeper.resolveDID(currentDid, {
                atVersion: version,
            });
            setAliasDocs(docs);
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

    async function handleSearchDidContents() {
        const query = formDid.trim();
        if (!query) {
            setError("Please enter a search substring.");
            return;
        }

        try {
            const response = await axios.get(`${searchServerURL}${VERSION}/search`, {
                params: { q: formDid }
            });

            setSearchResults(response.data);
            setAliasDocs(undefined);
            setSearchPage(0);
        } catch (error: any) {
            setError(error);
        }
    }

    let displayedResults: string[] = [];
    let total = 0;
    let totalPages = 1;

    if (searchResults) {
        total = searchResults.length;
        totalPages = Math.ceil(total / searchCount);

        const from = searchPage * searchCount;
        const to = from + searchCount;
        displayedResults = searchResults.slice(from, to);
    }

    function handleSearchCountChange(e: any) {
        setSearchCount(e.target.value);
        setSearchPage(0);
    }

    return (
        <Box sx={{ ml: 1 }}>
            <Box className="flex-box" sx={{ my: 2 }}>
                <TextField
                    label="DID or Search Text"
                    variant="outlined"
                    value={formDid}
                    onChange={trimQuotes}
                    size="small"
                    className="text-field single-line"
                    sx={{
                        width: 600,
                        height: 40,
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                    }}
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
                    sx={{
                        height: 40,
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                    }}
                >
                    Resolve DID
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSearchDidContents}
                    size="small"
                    className="button-right"
                    disabled={!formDid}
                    sx={{
                        height: 40,
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                    }}
                >
                    Search Text
                </Button>
            </Box>

            {searchResults && (
                <Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                        {searchResults.length > 0 && (
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <Select value={searchCount} onChange={handleSearchCountChange}>
                                    <MenuItem value={50}>50</MenuItem>
                                    <MenuItem value={100}>100</MenuItem>
                                    <MenuItem value={200}>200</MenuItem>
                                </Select>
                            </FormControl>
                        )}

                        <Box display="flex" alignItems="center" gap={1}>
                            <Button
                                variant="outlined"
                                size="small"
                                disabled={searchPage === 0}
                                onClick={() => setSearchPage((p) => p - 1)}
                            >
                                Prev
                            </Button>
                            <Typography>
                                Page {searchPage + 1} / {totalPages === 0 ? 1 : totalPages}
                            </Typography>
                            <Button
                                variant="outlined"
                                size="small"
                                disabled={searchPage + 1 >= totalPages}
                                onClick={() => setSearchPage((p) => p + 1)}
                            >
                                Next
                            </Button>
                        </Box>
                    </Box>

                    {searchResults.length === 0 ? (
                        <Typography>No results found.</Typography>
                    ) : (
                        <Box>
                            {displayedResults.map((did) => (
                                <Box
                                    key={did}
                                    display="flex"
                                    flexDirection="row"
                                    gap={1}
                                    sx={{ mt: 1 }}
                                >
                                    <Typography
                                        sx={{
                                            textDecoration: "underline",
                                            color: "blue",
                                            cursor: "pointer",
                                            maxWidth: 700,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                        title={did}
                                        onClick={() => handleResolveDID(did)}
                                    >
                                        {did}
                                    </Typography>
                                    <IconButton
                                        onClick={() => handleCopyDID(did, setError)}
                                        size="small"
                                        title="Copy DID"
                                    >
                                        <ContentCopy fontSize="small" />
                                    </IconButton>
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            )}

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
                                render={(
                                    { children, style, ...rest }: { children: ReactNode, style: CSSProperties, [key: string]: any },
                                    { type, value }: { type: string, value: string}
                                ) => {
                                    if (value.startsWith('did:') && type === 'value') {
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


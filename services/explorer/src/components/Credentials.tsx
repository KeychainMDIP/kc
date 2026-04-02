import React, { useCallback, useEffect, useMemo, useState } from "react";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import axios from "axios";
import JsonView from "@uiw/react-json-view";
import { GatekeeperInterface } from "@mdip/gatekeeper/types";
import {
    Box,
    Button,
    FormControl,
    MenuItem,
    Select,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

const searchServerURL = import.meta.env.VITE_SEARCH_SERVER || "http://localhost:4002";
const VERSION = "/api/v1";
const pageSizeOptions = [25, 50, 100];
const schemaPageSizeOptions = [25, 50, 100];

interface SchemaMetric {
    schemaDid: string;
    count: number;
}

interface PublishedCredentialRow {
    holderDid: string;
    credentialDid: string;
    schemaDid: string;
    issuerDid: string;
    subjectDid: string;
    revealed: boolean;
    updatedAt: string;
}

function getDidPrefix(did: string): string {
    const parts = did.split(":");

    if (parts.length < 2) {
        return did;
    }

    return `${parts[0]}:${parts[1]}`;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);

    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }

    return fallback;
}

function parseNonNegativeInteger(value: string | null, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);

    if (Number.isInteger(parsed) && parsed >= 0) {
        return parsed;
    }

    return fallback;
}

function formatTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return `${date.toISOString().replace("T", " ").slice(0, 16)}Z`;
}

function mapPublishedCredentialRow(row: any): PublishedCredentialRow {
    return {
        holderDid: row.holderDid,
        credentialDid: row.credentialDid,
        schemaDid: row.schemaDid,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        revealed: row.revealed === true,
        updatedAt: row.updatedAt,
    };
}

function ClickableDid(
    {
        did,
        onClick,
        maxWidth = 520,
    }: {
        did: string;
        onClick: () => void;
        maxWidth?: number | string;
    }
) {
    return (
        <Typography
            title={did}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
            sx={{
                fontFamily: "Courier, monospace",
                textDecoration: "underline",
                color: "primary.main",
                cursor: "pointer",
                maxWidth,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {did}
        </Typography>
    );
}

function JsonViewerDidLink({ did }: { did: string }) {
    return (
        <Typography
            component={RouterLink}
            to={`/search?did=${encodeURIComponent(did)}`}
            title={did}
            sx={{
                display: "block",
                fontFamily: "Courier, monospace",
                textDecoration: "underline",
                color: "primary.main",
                cursor: "pointer",
                wordBreak: "break-all",
            }}
        >
            {did}
        </Typography>
    );
}

function getManifestEntryFromDoc(
    {
        doc,
        credentialDid,
    }: {
        doc: Record<string, unknown>;
        credentialDid: string;
    }
): Record<string, unknown> | null {
    const didDocumentData = doc.didDocumentData;

    if (!didDocumentData || typeof didDocumentData !== "object" || Array.isArray(didDocumentData)) {
        return null;
    }

    const manifest = (didDocumentData as Record<string, unknown>).manifest;

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return null;
    }

    const entry = (manifest as Record<string, unknown>)[credentialDid];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
    }

    return entry as Record<string, unknown>;
}

function DidRow(
    {
        label,
        did,
    }: {
        label: string;
        did: string;
    }
) {
    return (
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
            <Typography variant="overline" sx={{ minWidth: 88 }}>
                {label}
            </Typography>
            <Box sx={{ minWidth: 0, flex: "1 1 0" }}>
                <JsonViewerDidLink did={did} />
            </Box>
        </Box>
    );
}

function SummaryCard(
    {
        label,
        value,
        minWidth = 280,
    }: {
        label: string;
        value: number;
        minWidth?: number;
    }
) {
    return (
        <Box
            sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                p: 2,
                minWidth,
                flex: `1 1 ${minWidth}px`,
            }}
        >
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2, whiteSpace: "nowrap" }}>
                <Typography
                    sx={{
                        fontSize: "0.95rem",
                        fontWeight: 500,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                    }}
                >
                    {label}
                </Typography>
                <Typography variant="h4" sx={{ fontSize: "2.1rem", lineHeight: 1 }}>
                    {value}
                </Typography>
            </Box>
        </Box>
    );
}

function Credentials(
    {
        gatekeeper,
        isReady,
        setError,
    }: {
        gatekeeper: GatekeeperInterface;
        isReady: boolean;
        setError: (error: any) => void;
    }
) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [schemaCounts, setSchemaCounts] = useState<SchemaMetric[]>([]);
    const [credentials, setCredentials] = useState<PublishedCredentialRow[]>([]);
    const [credentialTotal, setCredentialTotal] = useState<number>(0);
    const [schemaPageSize, setSchemaPageSize] = useState<number>(25);
    const [schemaPage, setSchemaPage] = useState<number>(0);
    const [detailRecord, setDetailRecord] = useState<PublishedCredentialRow | null>(null);
    const [detailDoc, setDetailDoc] = useState<Record<string, unknown> | null>(null);
    const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    const schemaDid = searchParams.get("schemaDid") ?? "";
    const selectedDetailDid = searchParams.get("detailDid") ?? "";
    const schemaPrefix = searchParams.get("schemaPrefix") ?? "";
    const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 25);
    const page = parseNonNegativeInteger(searchParams.get("page"), 0);

    const availableSchemaPrefixes = useMemo(
        () => Array.from(new Set(schemaCounts.map(row => getDidPrefix(row.schemaDid)))).sort(),
        [schemaCounts]
    );

    const hasMultipleSchemaPrefixes = availableSchemaPrefixes.length > 1;

    const filteredSchemaCounts = useMemo(() => {
        if (!schemaPrefix) {
            return schemaCounts;
        }

        return schemaCounts.filter(row => getDidPrefix(row.schemaDid) === schemaPrefix);
    }, [schemaCounts, schemaPrefix]);

    const totalPublished = useMemo(
        () => filteredSchemaCounts.reduce((sum, row) => sum + row.count, 0),
        [filteredSchemaCounts]
    );

    const selectedSchemaCount = useMemo(
        () => schemaCounts.find(row => row.schemaDid === schemaDid)?.count ?? 0,
        [schemaCounts, schemaDid]
    );

    const totalPages = Math.max(1, Math.ceil(credentialTotal / pageSize));
    const schemaTotalPages = Math.max(1, Math.ceil(filteredSchemaCounts.length / schemaPageSize));
    const pagedSchemaCounts = useMemo(() => {
        const from = schemaPage * schemaPageSize;
        const to = from + schemaPageSize;

        return filteredSchemaCounts.slice(from, to);
    }, [filteredSchemaCounts, schemaPage, schemaPageSize]);

    const listDetailRecord = useMemo(
        () => credentials.find(row => row.credentialDid === selectedDetailDid) ?? null,
        [credentials, selectedDetailDid]
    );

    const updateParams = useCallback((
        updates: Record<string, string | null | undefined>,
        options?: { replace?: boolean }
    ) => {
        const next = new URLSearchParams(searchParams);

        for (const [key, value] of Object.entries(updates)) {
            if (!value) {
                next.delete(key);
            }
            else {
                next.set(key, value);
            }
        }

        setSearchParams(next, options);
    }, [searchParams, setSearchParams]);

    function handleSelectSchema(nextSchemaDid: string) {
        updateParams({
            schemaDid: nextSchemaDid,
            detailDid: null,
            page: "0",
        });
    }

    function handleBackToSchemas() {
        updateParams({
            schemaDid: null,
            detailDid: null,
            page: "0",
        });
    }

    function handleOpenDidDetail(did: string) {
        updateParams({
            detailDid: did,
        });
    }

    function handleBackFromDetail() {
        updateParams({
            detailDid: null,
        }, { replace: true });
    }

    function handlePageSizeChange(value: number) {
        updateParams({
            pageSize: value.toString(),
            page: "0",
        });
    }

    function handleSchemaPrefixChange(value: string) {
        updateParams({
            schemaPrefix: value || null,
        });
        setSchemaPage(0);
    }

    function handleSchemaPageSizeChange(value: number) {
        setSchemaPageSize(value);
        setSchemaPage(0);
    }

    useEffect(() => {
        let ignore = false;

        async function fetchSchemaCounts() {
            try {
                const response = await axios.get(`${searchServerURL}${VERSION}/metrics/schemas/published`);

                if (!ignore) {
                    setSchemaCounts(response.data.schemas ?? []);
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setError(error);
                }
            }
        }

        fetchSchemaCounts();

        return () => {
            ignore = true;
        };
    }, [setError]);

    useEffect(() => {
        let ignore = false;

        async function fetchCredentials() {
            if (!schemaDid) {
                setCredentials([]);
                setCredentialTotal(0);
                return;
            }

            try {
                const response = await axios.get(`${searchServerURL}${VERSION}/metrics/credentials/published`, {
                    params: {
                        schemaDid,
                        limit: pageSize,
                        offset: page * pageSize,
                    }
                });

                const total = response.data.total ?? 0;

                if (!ignore) {
                    if (total > 0 && page * pageSize >= total && page > 0) {
                        updateParams({ page: "0" });
                        return;
                    }

                    setCredentialTotal(total);
                    setCredentials((response.data.credentials ?? []).map(mapPublishedCredentialRow));
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setError(error);
                }
            }
        }

        fetchCredentials();

        return () => {
            ignore = true;
        };
    }, [page, pageSize, schemaDid, setError, updateParams]);

    useEffect(() => {
        const maxPage = Math.max(0, Math.ceil(filteredSchemaCounts.length / schemaPageSize) - 1);

        if (schemaPage > maxPage) {
            setSchemaPage(maxPage);
        }
    }, [filteredSchemaCounts.length, schemaPage, schemaPageSize]);

    useEffect(() => {
        if (schemaPrefix && !availableSchemaPrefixes.includes(schemaPrefix)) {
            updateParams({
                schemaPrefix: null,
            }, { replace: true });
        }
    }, [availableSchemaPrefixes, schemaPrefix, updateParams]);

    useEffect(() => {
        if (selectedDetailDid && detailRecord && !schemaDid) {
            updateParams({
                schemaDid: detailRecord.schemaDid,
            }, { replace: true });
        }
    }, [detailRecord, schemaDid, selectedDetailDid, updateParams]);

    useEffect(() => {
        let ignore = false;

        async function fetchDetail() {
            if (!selectedDetailDid) {
                setDetailRecord(null);
                setDetailDoc(null);
                setDetailError(null);
                setIsDetailLoading(false);
                return;
            }

            if (!isReady) {
                setDetailRecord(null);
                setDetailDoc(null);
                setDetailError("Waiting for Gatekeeper...");
                setIsDetailLoading(false);
                return;
            }

            setIsDetailLoading(true);
            setDetailError(null);

            try {
                let nextDetailRecord = listDetailRecord;

                if (!nextDetailRecord && selectedDetailDid !== schemaDid) {
                    const response = await axios.get(`${searchServerURL}${VERSION}/metrics/credentials/published`, {
                        params: {
                            credentialDid: selectedDetailDid,
                            schemaDid: schemaDid || undefined,
                            limit: 1,
                            offset: 0,
                        }
                    });

                    const fetchedRow = response.data.credentials?.[0];
                    if (fetchedRow) {
                        nextDetailRecord = mapPublishedCredentialRow(fetchedRow);
                    }
                }

                if (!ignore) {
                    setDetailRecord(nextDetailRecord);
                }

                if (nextDetailRecord) {
                    const subjectDoc = await gatekeeper.resolveDID(nextDetailRecord.subjectDid) as Record<string, unknown>;
                    const manifestEntry = getManifestEntryFromDoc({
                        doc: subjectDoc,
                        credentialDid: nextDetailRecord.credentialDid,
                    });

                    if (!ignore) {
                        if (!manifestEntry) {
                            setDetailDoc(null);
                            setDetailError("Published credential manifest entry not found.");
                        }
                        else {
                            setDetailDoc(manifestEntry);
                        }
                    }

                    return;
                }

                const response = await gatekeeper.resolveDID(selectedDetailDid) as Record<string, unknown>;

                if (!ignore) {
                    setDetailDoc(response);
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setDetailRecord(null);
                    setDetailDoc(null);

                    if (error?.response?.status === 404 || error?.message === "Not found") {
                        setDetailError("DID document not found.");
                    }
                    else {
                        setDetailError("Unable to load DID document.");
                        setError(error);
                    }
                }
            }
            finally {
                if (!ignore) {
                    setIsDetailLoading(false);
                }
            }
        }

        fetchDetail();

        return () => {
            ignore = true;
        };
    }, [gatekeeper, isReady, listDetailRecord, schemaDid, selectedDetailDid, setError]);

    return (
        <Box sx={{ ml: 1, mt: 2, minWidth: 860 }}>
            {selectedDetailDid ? (
                <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                        <Button
                            variant="outlined"
                            onClick={handleBackFromDetail}
                            startIcon={<ArrowBackIosNewIcon fontSize="small" />}
                        >
                            Back
                        </Button>
                        {!detailRecord && (
                            <>
                                <Typography variant="overline" sx={{ whiteSpace: "nowrap" }}>
                                    {schemaDid && selectedDetailDid === schemaDid ? "Schema" : "DID"}
                                </Typography>
                                <Typography
                                    title={selectedDetailDid}
                                    sx={{
                                        fontFamily: "Courier, monospace",
                                        wordBreak: "break-all",
                                    }}
                                >
                                    {selectedDetailDid}
                                </Typography>
                            </>
                        )}
                    </Box>

                    {detailRecord && (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 3 }}>
                            <DidRow label="Credential" did={detailRecord.credentialDid} />
                            <DidRow label="Subject" did={detailRecord.subjectDid} />
                            <DidRow label="Issuer" did={detailRecord.issuerDid} />
                            <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
                                <Typography variant="overline" sx={{ minWidth: 88 }}>
                                    Revealed
                                </Typography>
                                <Typography>{String(detailRecord.revealed)}</Typography>
                            </Box>
                        </Box>
                    )}

                    {isDetailLoading ? (
                        <Typography>Loading DID document...</Typography>
                    ) : detailError ? (
                        <Typography>{detailError}</Typography>
                    ) : detailDoc ? (
                        <Box sx={{ overflowX: "auto" }}>
                            <JsonView
                                value={detailDoc}
                                collapsed={false}
                                shouldExpandNodeInitially={() => true}
                                shortenTextAfterLength={0}
                            />
                        </Box>
                    ) : (
                        <Typography>No DID document found.</Typography>
                    )}
                </>
            ) : !schemaDid ? (
                <>
                    <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", mb: 2, gap: 2, flexWrap: "wrap" }}>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", flex: "1 1 620px" }}>
                            <SummaryCard label="Total Published" value={totalPublished} />
                            <SummaryCard label="Schemas In Use" value={filteredSchemaCounts.length} />
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", ml: "auto" }}>
                            {hasMultipleSchemaPrefixes && (
                                <FormControl size="small" sx={{ minWidth: 140 }}>
                                    <Select
                                        value={schemaPrefix}
                                        displayEmpty
                                        onChange={(event) => handleSchemaPrefixChange(event.target.value as string)}
                                    >
                                        <MenuItem value="">All</MenuItem>
                                        {availableSchemaPrefixes.map((prefix) => (
                                            <MenuItem key={prefix} value={prefix}>
                                                {prefix}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}

                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <Select
                                    value={schemaPageSize}
                                    onChange={(event) => handleSchemaPageSizeChange(event.target.value as number)}
                                >
                                    {schemaPageSizeOptions.map((option) => (
                                        <MenuItem key={option} value={option}>
                                            {option}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <Box display="flex" alignItems="center" gap={1}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={schemaPage === 0}
                                    onClick={() => setSchemaPage(schemaPage - 1)}
                                >
                                    Prev
                                </Button>
                                <Typography>
                                    Page {schemaPage + 1} / {schemaTotalPages === 0 ? 1 : schemaTotalPages}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={schemaPage + 1 >= schemaTotalPages}
                                    onClick={() => setSchemaPage(schemaPage + 1)}
                                >
                                    Next
                                </Button>
                            </Box>
                        </Box>
                    </Box>

                    {filteredSchemaCounts.length === 0 ? (
                        <Typography>No published credentials found.</Typography>
                    ) : (
                        <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Schema</TableCell>
                                        <TableCell width={140}>Published</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {pagedSchemaCounts.map((row) => (
                                        <TableRow
                                            key={row.schemaDid}
                                            hover
                                            onClick={() => handleSelectSchema(row.schemaDid)}
                                            sx={{ cursor: "pointer" }}
                                        >
                                            <TableCell>
                                                <ClickableDid did={row.schemaDid} onClick={() => handleSelectSchema(row.schemaDid)} />
                                            </TableCell>
                                            <TableCell>{row.count}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            ) : (
                <>
                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, mb: 2 }}>
                        <Button
                            variant="outlined"
                            onClick={handleBackToSchemas}
                            startIcon={<ArrowBackIosNewIcon fontSize="small" />}
                        >
                            Back
                        </Button>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", minWidth: 0, width: "100%" }}>
                            <Typography variant="overline" sx={{ whiteSpace: "nowrap", minWidth: 88 }}>
                                Schema
                            </Typography>
                            <Box sx={{ minWidth: 0, flex: "1 1 0" }}>
                                <ClickableDid
                                    did={schemaDid}
                                    onClick={() => handleOpenDidDetail(schemaDid)}
                                    maxWidth="100%"
                                />
                            </Box>
                        </Box>
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
                        <SummaryCard label="Published Credentials" value={selectedSchemaCount} minWidth={320} />
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", ml: "auto" }}>
                            <FormControl size="small" sx={{ minWidth: 100 }}>
                                <Select
                                    value={pageSize}
                                    onChange={(event) => handlePageSizeChange(event.target.value as number)}
                                >
                                    {pageSizeOptions.map((option) => (
                                        <MenuItem key={option} value={option}>
                                            {option}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Box display="flex" alignItems="center" gap={1}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={page === 0}
                                    onClick={() => updateParams({ page: String(page - 1) })}
                                >
                                    Prev
                                </Button>
                                <Typography>
                                    Page {Math.min(page + 1, totalPages)} / {totalPages}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={page + 1 >= totalPages}
                                    onClick={() => updateParams({ page: String(page + 1) })}
                                >
                                    Next
                                </Button>
                            </Box>
                        </Box>
                    </Box>

                    {credentials.length === 0 ? (
                        <Typography>No published credentials found for this schema.</Typography>
                    ) : (
                        <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Credential</TableCell>
                                        <TableCell width={190}>Published</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {credentials.map((row) => (
                                        <TableRow
                                            key={row.credentialDid}
                                            hover
                                            onClick={() => handleOpenDidDetail(row.credentialDid)}
                                            sx={{ cursor: "pointer" }}
                                        >
                                            <TableCell>
                                                <ClickableDid
                                                    did={row.credentialDid}
                                                    onClick={() => handleOpenDidDetail(row.credentialDid)}
                                                />
                                            </TableCell>
                                            <TableCell>{formatTimestamp(row.updatedAt)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            )}
        </Box>
    );
}

export default React.memo(Credentials);

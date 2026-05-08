import React, { useCallback, useEffect, useMemo, useState } from "react";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import axios from "axios";
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
    TextField,
    Typography,
} from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

const searchServerURL = import.meta.env.VITE_SEARCH_SERVER || "http://localhost:4002";
const VERSION = "/api/v1";
const pageSizeOptions = [25, 50, 100];
const usageFetchLimit = 500;
const receiptBrowseFetchLimit = 500;

interface ChallengeReceiptUsageRow {
    attesterDid: string;
    schemaDid: string;
    requesterDid: string;
    count: number;
    firstVerifiedAt: string;
    lastVerifiedAt: string;
}

interface ChallengeReceiptRow {
    receiptDid: string;
    attesterDid: string;
    schemaDid: string;
    requesterDid: string;
    verifiedAt: string;
    responseCommitment: string;
    updatedAt: string;
}

interface AttesterUsageRow {
    attesterDid: string;
    count: number;
    templateCount: number;
    requesterCount: number;
    firstVerifiedAt: string;
    lastVerifiedAt: string;
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

function getStartOfDay(value: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getEndOfDay(value: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const date = new Date(`${value}T23:59:59.999Z`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function mapUsageRow(row: any): ChallengeReceiptUsageRow {
    return {
        attesterDid: row.attesterDid,
        schemaDid: row.schemaDid,
        requesterDid: row.requesterDid,
        count: Number(row.count ?? 0),
        firstVerifiedAt: row.firstVerifiedAt,
        lastVerifiedAt: row.lastVerifiedAt,
    };
}

function mapReceiptRow(row: any): ChallengeReceiptRow {
    return {
        receiptDid: row.receiptDid,
        attesterDid: row.attesterDid,
        schemaDid: row.schemaDid,
        requesterDid: row.requesterDid,
        verifiedAt: row.verifiedAt,
        responseCommitment: row.responseCommitment,
        updatedAt: row.updatedAt,
    };
}

function DidLink(
    {
        did,
        maxWidth = 420,
    }: {
        did: string;
        maxWidth?: number | string;
    }
) {
    return (
        <Typography
            component={RouterLink}
            to={`/search?did=${encodeURIComponent(did)}`}
            title={did}
            onClick={(event) => {
                event.stopPropagation();
            }}
            sx={{
                display: "block",
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

function SelectableDid(
    {
        did,
        onClick,
        maxWidth = 420,
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
                display: "block",
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

function SummaryCard(
    {
        label,
        value,
    }: {
        label: string;
        value: number;
    }
) {
    return (
        <Box
            sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                p: 2,
                minWidth: 230,
                flex: "1 1 230px",
            }}
        >
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
                <Typography
                    sx={{
                        fontSize: "0.9rem",
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

function groupReceiptsByAttester(receipts: ChallengeReceiptRow[]): AttesterUsageRow[] {
    const groups = new Map<string, {
        commitments: Set<string>;
        requesters: Set<string>;
        templates: Set<string>;
        row: AttesterUsageRow;
    }>();

    for (const receipt of receipts) {
        const existing = groups.get(receipt.attesterDid);

        if (!existing) {
            groups.set(receipt.attesterDid, {
                commitments: new Set([receipt.responseCommitment]),
                requesters: new Set([receipt.requesterDid]),
                templates: new Set([receipt.schemaDid]),
                row: {
                    attesterDid: receipt.attesterDid,
                    count: 1,
                    templateCount: 1,
                    requesterCount: 1,
                    firstVerifiedAt: receipt.verifiedAt,
                    lastVerifiedAt: receipt.verifiedAt,
                },
            });
            continue;
        }

        existing.commitments.add(receipt.responseCommitment);
        existing.requesters.add(receipt.requesterDid);
        existing.templates.add(receipt.schemaDid);
        existing.row.count = existing.commitments.size;
        existing.row.requesterCount = existing.requesters.size;
        existing.row.templateCount = existing.templates.size;

        if (receipt.verifiedAt < existing.row.firstVerifiedAt) {
            existing.row.firstVerifiedAt = receipt.verifiedAt;
        }
        if (receipt.verifiedAt > existing.row.lastVerifiedAt) {
            existing.row.lastVerifiedAt = receipt.verifiedAt;
        }
    }

    return Array.from(groups.values())
        .map(group => group.row)
        .sort((a, b) => b.count - a.count || a.attesterDid.localeCompare(b.attesterDid));
}

function ChallengeReceipts({ setError }: { setError: (error: any) => void }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [draftAttesterDid, setDraftAttesterDid] = useState<string>(searchParams.get("attesterDid") ?? "");
    const [draftDateFrom, setDraftDateFrom] = useState<string>(searchParams.get("dateFrom") ?? "");
    const [draftDateTo, setDraftDateTo] = useState<string>(searchParams.get("dateTo") ?? "");
    const [attesterRows, setAttesterRows] = useState<AttesterUsageRow[]>([]);
    const [usageRows, setUsageRows] = useState<ChallengeReceiptUsageRow[]>([]);
    const [receipts, setReceipts] = useState<ChallengeReceiptRow[]>([]);
    const [receiptTotal, setReceiptTotal] = useState<number>(0);
    const [isAttesterLoading, setIsAttesterLoading] = useState<boolean>(false);
    const [isUsageLoading, setIsUsageLoading] = useState<boolean>(false);
    const [isReceiptLoading, setIsReceiptLoading] = useState<boolean>(false);

    const attesterDid = searchParams.get("attesterDid") ?? "";
    const dateFrom = searchParams.get("dateFrom") ?? "";
    const dateTo = searchParams.get("dateTo") ?? "";
    const selectedSchemaDid = searchParams.get("detailSchemaDid") ?? "";
    const selectedRequesterDid = searchParams.get("detailRequesterDid") ?? "";
    const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 25);
    const page = parseNonNegativeInteger(searchParams.get("page"), 0);
    const receiptPageSize = parsePositiveInteger(searchParams.get("receiptPageSize"), 25);
    const receiptPage = parseNonNegativeInteger(searchParams.get("receiptPage"), 0);

    const verifiedAfter = useMemo(() => getStartOfDay(dateFrom), [dateFrom]);
    const verifiedBefore = useMemo(() => getEndOfDay(dateTo), [dateTo]);

    const filteredAttesterRows = useMemo(() => {
        const query = draftAttesterDid.trim().toLowerCase();

        if (!query || attesterDid) {
            return attesterRows;
        }

        return attesterRows.filter(row => row.attesterDid.toLowerCase().includes(query));
    }, [attesterDid, attesterRows, draftAttesterDid]);

    const totalPages = Math.max(1, Math.ceil(usageRows.length / pageSize));
    const attesterTotalPages = Math.max(1, Math.ceil(filteredAttesterRows.length / pageSize));
    const receiptTotalPages = Math.max(1, Math.ceil(receiptTotal / receiptPageSize));
    const pagedUsageRows = useMemo(() => {
        const from = page * pageSize;
        const to = from + pageSize;

        return usageRows.slice(from, to);
    }, [page, pageSize, usageRows]);
    const pagedAttesterRows = useMemo(() => {
        const from = page * pageSize;
        const to = from + pageSize;

        return filteredAttesterRows.slice(from, to);
    }, [filteredAttesterRows, page, pageSize]);

    const selectedUsageRow = useMemo(
        () => usageRows.find(row => row.schemaDid === selectedSchemaDid && row.requesterDid === selectedRequesterDid) ?? null,
        [selectedRequesterDid, selectedSchemaDid, usageRows]
    );

    const totalSuccessfulUses = useMemo(
        () => usageRows.reduce((sum, row) => sum + row.count, 0),
        [usageRows]
    );
    const templateCount = useMemo(
        () => new Set(usageRows.map(row => row.schemaDid)).size,
        [usageRows]
    );
    const requesterCount = useMemo(
        () => new Set(usageRows.map(row => row.requesterDid)).size,
        [usageRows]
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

    function handleSearch() {
        const next = new URLSearchParams();

        if (draftAttesterDid.trim()) {
            next.set("attesterDid", draftAttesterDid.trim());
        }
        if (draftDateFrom) {
            next.set("dateFrom", draftDateFrom);
        }
        if (draftDateTo) {
            next.set("dateTo", draftDateTo);
        }
        next.set("page", "0");
        next.set("pageSize", pageSize.toString());

        setSearchParams(next);
    }

    function handleSelectAttester(nextAttesterDid: string) {
        const next = new URLSearchParams();

        next.set("attesterDid", nextAttesterDid);
        if (draftDateFrom) {
            next.set("dateFrom", draftDateFrom);
        }
        if (draftDateTo) {
            next.set("dateTo", draftDateTo);
        }
        next.set("page", "0");
        next.set("pageSize", pageSize.toString());

        setSearchParams(next);
    }

    function handleSelectUsageRow(row: ChallengeReceiptUsageRow) {
        updateParams({
            detailSchemaDid: row.schemaDid,
            detailRequesterDid: row.requesterDid,
            receiptPage: "0",
        });
    }

    function handleBackFromReceipts() {
        updateParams({
            detailSchemaDid: null,
            detailRequesterDid: null,
            receiptPage: null,
        }, { replace: true });
    }

    useEffect(() => {
        setDraftAttesterDid(searchParams.get("attesterDid") ?? "");
        setDraftDateFrom(searchParams.get("dateFrom") ?? "");
        setDraftDateTo(searchParams.get("dateTo") ?? "");
    }, [searchParams]);

    useEffect(() => {
        let ignore = false;

        async function fetchAttesterRows() {
            if (attesterDid) {
                setAttesterRows([]);
                setIsAttesterLoading(false);
                return;
            }

            setIsAttesterLoading(true);

            try {
                const allReceipts: ChallengeReceiptRow[] = [];
                let offset = 0;
                let total = 0;

                do {
                    const response = await axios.get(`${searchServerURL}${VERSION}/metrics/challenge-receipts`, {
                        params: {
                            verifiedAfter,
                            verifiedBefore,
                            limit: receiptBrowseFetchLimit,
                            offset,
                        },
                    });

                    total = response.data.total ?? 0;
                    allReceipts.push(...(response.data.receipts ?? []).map(mapReceiptRow));
                    offset += receiptBrowseFetchLimit;
                } while (offset < total);

                if (!ignore) {
                    setAttesterRows(groupReceiptsByAttester(allReceipts));
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setAttesterRows([]);
                    setError(error);
                }
            }
            finally {
                if (!ignore) {
                    setIsAttesterLoading(false);
                }
            }
        }

        fetchAttesterRows();

        return () => {
            ignore = true;
        };
    }, [attesterDid, setError, verifiedAfter, verifiedBefore]);

    useEffect(() => {
        let ignore = false;

        async function fetchUsageRows() {
            if (!attesterDid) {
                setUsageRows([]);
                setReceipts([]);
                setReceiptTotal(0);
                return;
            }

            setIsUsageLoading(true);

            try {
                const allRows: ChallengeReceiptUsageRow[] = [];
                let offset = 0;
                let total = 0;

                do {
                    const response = await axios.get(`${searchServerURL}${VERSION}/metrics/challenge-receipts/usage`, {
                        params: {
                            attesterDid,
                            verifiedAfter,
                            verifiedBefore,
                            limit: usageFetchLimit,
                            offset,
                        },
                    });

                    total = response.data.total ?? 0;
                    allRows.push(...(response.data.usage ?? []).map(mapUsageRow));
                    offset += usageFetchLimit;
                } while (offset < total);

                if (!ignore) {
                    setUsageRows(allRows);
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setUsageRows([]);
                    setError(error);
                }
            }
            finally {
                if (!ignore) {
                    setIsUsageLoading(false);
                }
            }
        }

        fetchUsageRows();

        return () => {
            ignore = true;
        };
    }, [attesterDid, setError, verifiedAfter, verifiedBefore]);

    useEffect(() => {
        const rowCount = attesterDid ? usageRows.length : filteredAttesterRows.length;
        const maxPage = Math.max(0, Math.ceil(rowCount / pageSize) - 1);

        if (page > maxPage) {
            updateParams({ page: "0" }, { replace: true });
        }
    }, [attesterDid, filteredAttesterRows.length, page, pageSize, updateParams, usageRows.length]);

    useEffect(() => {
        let ignore = false;

        async function fetchReceiptRows() {
            if (!attesterDid || !selectedSchemaDid || !selectedRequesterDid) {
                setReceipts([]);
                setReceiptTotal(0);
                return;
            }

            setIsReceiptLoading(true);

            try {
                const response = await axios.get(`${searchServerURL}${VERSION}/metrics/challenge-receipts`, {
                    params: {
                        attesterDid,
                        schemaDid: selectedSchemaDid,
                        requesterDid: selectedRequesterDid,
                        verifiedAfter,
                        verifiedBefore,
                        limit: receiptPageSize,
                        offset: receiptPage * receiptPageSize,
                    },
                });
                const total = response.data.total ?? 0;

                if (!ignore) {
                    if (total > 0 && receiptPage * receiptPageSize >= total && receiptPage > 0) {
                        updateParams({ receiptPage: "0" });
                        return;
                    }

                    setReceiptTotal(total);
                    setReceipts((response.data.receipts ?? []).map(mapReceiptRow));
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setReceipts([]);
                    setReceiptTotal(0);
                    setError(error);
                }
            }
            finally {
                if (!ignore) {
                    setIsReceiptLoading(false);
                }
            }
        }

        fetchReceiptRows();

        return () => {
            ignore = true;
        };
    }, [
        attesterDid,
        receiptPage,
        receiptPageSize,
        selectedRequesterDid,
        selectedSchemaDid,
        setError,
        updateParams,
        verifiedAfter,
        verifiedBefore,
    ]);

    return (
        <Box sx={{ ml: 1, mt: 2, minWidth: 860 }}>
            {selectedUsageRow ? (
                <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                        <Button
                            variant="outlined"
                            onClick={handleBackFromReceipts}
                            startIcon={<ArrowBackIosNewIcon fontSize="small" />}
                        >
                            Back
                        </Button>
                        <Typography variant="h6">Receipts</Typography>
                    </Box>

                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 3 }}>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
                            <Typography variant="overline" sx={{ minWidth: 100 }}>
                                Schema
                            </Typography>
                            <DidLink did={selectedUsageRow.schemaDid} maxWidth="100%" />
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
                            <Typography variant="overline" sx={{ minWidth: 100 }}>
                                Requester
                            </Typography>
                            <DidLink did={selectedUsageRow.requesterDid} maxWidth="100%" />
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
                            <Typography variant="overline" sx={{ minWidth: 100 }}>
                                Uses
                            </Typography>
                            <Typography>{selectedUsageRow.count}</Typography>
                        </Box>
                    </Box>

                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                        <Typography>
                            {receiptTotal} receipt{receiptTotal === 1 ? "" : "s"}
                        </Typography>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                            <FormControl size="small" sx={{ minWidth: 100 }}>
                                <Select
                                    value={receiptPageSize}
                                    onChange={(event) => updateParams({
                                        receiptPageSize: String(event.target.value),
                                        receiptPage: "0",
                                    })}
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
                                    disabled={receiptPage === 0}
                                    onClick={() => updateParams({ receiptPage: String(receiptPage - 1) })}
                                >
                                    Prev
                                </Button>
                                <Typography>
                                    Page {Math.min(receiptPage + 1, receiptTotalPages)} / {receiptTotalPages}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={receiptPage + 1 >= receiptTotalPages}
                                    onClick={() => updateParams({ receiptPage: String(receiptPage + 1) })}
                                >
                                    Next
                                </Button>
                            </Box>
                        </Box>
                    </Box>

                    {isReceiptLoading ? (
                        <Typography>Loading receipts...</Typography>
                    ) : receipts.length === 0 ? (
                        <Typography>No receipts found for this usage row.</Typography>
                    ) : (
                        <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell width={180}>Verified</TableCell>
                                        <TableCell>Receipt DID</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {receipts.map((row) => (
                                        <TableRow key={row.receiptDid}>
                                            <TableCell>{formatTimestamp(row.verifiedAt)}</TableCell>
                                            <TableCell>
                                                <DidLink did={row.receiptDid} maxWidth="none" />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            ) : (
                <>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 3 }}>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                            <TextField
                                label="Attester DID"
                                value={draftAttesterDid}
                                onChange={(event) => setDraftAttesterDid(event.target.value)}
                                size="small"
                                required
                                sx={{ flex: "1 1 100%" }}
                            />
                        </Box>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
                            <TextField
                                label="From"
                                type="date"
                                value={draftDateFrom}
                                onChange={(event) => setDraftDateFrom(event.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                                sx={{ width: 180 }}
                            />
                            <TextField
                                label="To"
                                type="date"
                                value={draftDateTo}
                                onChange={(event) => setDraftDateTo(event.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                                sx={{ width: 180 }}
                            />
                            <Button
                                variant="contained"
                                onClick={handleSearch}
                            >
                                Search
                            </Button>
                        </Box>
                    </Box>

                    {!attesterDid ? (
                        <>
                            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                                <Box>
                                    <Typography variant="h6">Attesters</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Select an attester to view usage.
                                    </Typography>
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                                    <FormControl size="small" sx={{ minWidth: 100 }}>
                                        <Select
                                            value={pageSize}
                                            onChange={(event) => updateParams({
                                                pageSize: String(event.target.value),
                                                page: "0",
                                            })}
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
                                            Page {Math.min(page + 1, attesterTotalPages)} / {attesterTotalPages}
                                        </Typography>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            disabled={page + 1 >= attesterTotalPages}
                                            onClick={() => updateParams({ page: String(page + 1) })}
                                        >
                                            Next
                                        </Button>
                                    </Box>
                                </Box>
                            </Box>

                            {isAttesterLoading ? (
                                <Typography>Loading attesters...</Typography>
                            ) : filteredAttesterRows.length === 0 ? (
                                <Typography>No challenge receipt usage found.</Typography>
                            ) : (
                                <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Attester DID</TableCell>
                                                <TableCell width={90}>Uses</TableCell>
                                                <TableCell width={110}>Templates</TableCell>
                                                <TableCell width={110}>Requesters</TableCell>
                                                <TableCell width={170}>First Verified</TableCell>
                                                <TableCell width={170}>Last Verified</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {pagedAttesterRows.map((row) => (
                                                <TableRow
                                                    key={row.attesterDid}
                                                    hover
                                                    onClick={() => handleSelectAttester(row.attesterDid)}
                                                    sx={{ cursor: "pointer" }}
                                                >
                                                    <TableCell>
                                                        <SelectableDid
                                                            did={row.attesterDid}
                                                            onClick={() => handleSelectAttester(row.attesterDid)}
                                                            maxWidth={300}
                                                        />
                                                    </TableCell>
                                                    <TableCell>{row.count}</TableCell>
                                                    <TableCell>{row.templateCount}</TableCell>
                                                    <TableCell>{row.requesterCount}</TableCell>
                                                    <TableCell>{formatTimestamp(row.firstVerifiedAt)}</TableCell>
                                                    <TableCell>{formatTimestamp(row.lastVerifiedAt)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </>
                    ) : (
                        <>
                            <Typography variant="h6" sx={{ mb: 2 }}>Usage</Typography>
                            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
                                <SummaryCard label="Successful Uses" value={totalSuccessfulUses} />
                                <SummaryCard label="Templates Used" value={templateCount} />
                                <SummaryCard label="Requesters" value={requesterCount} />
                            </Box>

                            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="overline">Attester</Typography>
                                    <DidLink did={attesterDid} maxWidth={620} />
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                                    <FormControl size="small" sx={{ minWidth: 100 }}>
                                        <Select
                                            value={pageSize}
                                            onChange={(event) => updateParams({
                                                pageSize: String(event.target.value),
                                                page: "0",
                                            })}
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

                            {isUsageLoading ? (
                                <Typography>Loading receipt usage...</Typography>
                            ) : usageRows.length === 0 ? (
                                <Typography>No challenge receipt usage found.</Typography>
                            ) : (
                                <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Schema DID</TableCell>
                                                <TableCell width={90}>Count</TableCell>
                                                <TableCell width={170}>First Verified</TableCell>
                                                <TableCell width={170}>Last Verified</TableCell>
                                                <TableCell width={130}>Receipts</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {pagedUsageRows.map((row) => (
                                                <TableRow
                                                    key={`${row.schemaDid}:${row.requesterDid}`}
                                                    hover
                                                >
                                                    <TableCell>
                                                        <DidLink did={row.schemaDid} maxWidth={260} />
                                                    </TableCell>
                                                    <TableCell>{row.count}</TableCell>
                                                    <TableCell>{formatTimestamp(row.firstVerifiedAt)}</TableCell>
                                                    <TableCell>{formatTimestamp(row.lastVerifiedAt)}</TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            onClick={() => handleSelectUsageRow(row)}
                                                        >
                                                            View
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </>
                    )}
                </>
            )}
        </Box>
    );
}

export default React.memo(ChallengeReceipts);

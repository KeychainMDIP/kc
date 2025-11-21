import React, { useState } from "react";
import {
    Box,
    Button,
    Menu,
    MenuItem,
} from "@mui/material";
import { ArrowDropDown } from "@mui/icons-material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useUIContext } from "../contexts/UIContext";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import CopyResolveDID from "./CopyResolveDID";

const DropDownID = () => {
    const { keymaster } = useWalletContext();
    const {
        currentDID,
        currentId,
        idList,
        unresolvedIdList,
    } = useVariablesContext();
    const { setError } = useSnackbar();
    const { resetCurrentID } = useUIContext();

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    const truncatedId =
        currentId?.length > 10 ? currentId.slice(0, 10) + "..." : currentId;

    async function selectId(id: string) {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.setCurrentId(id);

            await resetCurrentID();
        } catch (error: any) {
            setError(error);
        }
    }

    const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchorEl(null);
    };

    async function handleSelectID(id: string) {
        handleCloseMenu();
        await selectId(id);
    }

    const combinedList = [
        ...idList.map(id => ({ id, unresolved: false })),
        ...unresolvedIdList
            .filter(id => !idList.includes(id))
            .map(id => ({ id, unresolved: true })),
    ].sort((a, b) => a.id.localeCompare(b.id));

    const multipleIds = combinedList && combinedList.length > 1;

    return (
        currentId && (
            <Box display="flex" alignItems="center" gap={0}>
                <CopyResolveDID did={currentDID} />

                {multipleIds ? (
                    <>
                        <Button
                            className="drop-down-id-button"
                            onClick={handleOpenMenu}
                            endIcon={<ArrowDropDown />}
                            sx={{
                                textTransform: "none",
                            }}
                            size="small"
                            variant="outlined"
                        >
                            {truncatedId}
                        </Button>

                        <Menu
                            anchorEl={anchorEl}
                            open={Boolean(anchorEl)}
                            onClose={handleCloseMenu}
                            anchorOrigin={{
                                vertical: "bottom",
                                horizontal: "right",
                            }}
                            transformOrigin={{
                                vertical: "top",
                                horizontal: "right",
                            }}
                        >
                            {combinedList.map(({ id, unresolved }) => (
                                <MenuItem
                                    key={id}
                                    onClick={() => handleSelectID(id)}
                                    sx={unresolved ? { color: 'red' } : {}}
                                >
                                    {id}
                                </MenuItem>
                            ))}
                        </Menu>
                    </>
                ) : (
                    <Box className="drop-down-id-box">{truncatedId}</Box>
                )}
            </Box>
        )
    );
};

export default DropDownID;
